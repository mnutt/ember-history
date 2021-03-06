/**
 *
 * @author Ignas Bernotas (c) 2012
 * @url http://blog.iber.co.uk/javascript/2012/06/28/emberjs-history-with-undo-redo/
 * @license MIT
 */
UndoHistory = {

    _max: 30,       // max number of states we store
    _states: [],    // array of states
    _index: -1,     // current index
    _interval: 300, // interval under which we group changes, in ms

    // these are needed for a check when pushing a state

    _isUndo: false,
    _isRedo: false,
    _active: true,

    disable: function() {
        this._active = false;
    },

    enable: function() {
        this._active = true;
    },

    isActive: function() {
        return this._active && !this._isUndo && !this._isRedo;
    },

    /**
     * Clear all history entries
     */
    clear: function() {
        this._states = [];
        this._index = -1;
    },
    /**
     * Push a new history state
     */
    pushState: function(obj) {
        this.clearFuture();

        if(this.isPartOfExistingState(obj)) {
            this._states[this._index].push(obj);
        } else {
            this._states[this._index+1] = [obj];
            this._index++;
        }

        if(this._states.length > this._max) {
            this._states = this._states.slice(1, this._states.length);
            this._index = this._states.length-1;
        }
    },
    isPartOfExistingState: function(obj) {
        var existing = this._states[this._index];
        if(!existing) return false
        return obj.timestamp - existing[0].timestamp < this._interval;
    },
    /**
     * Update last history state
     */
    updateLastState: function(prop, value) {
        var stateGroup = this._states[this._index];
        for(var i = stateGroup.length - 1; i >= 0; i--) {
            if(stateGroup[i].property == prop) {
                stateGroup[i].after = value;
                return;
            }
        }
    },
    /**
     * This method clears all the states after the current index
     */
    clearFuture: function() {
        if(this._index != this._states.length-1) {
            this._states = this._states.slice( 0, this._index +1 );
        }
    },
    /**
     * Load state for undo
     */
    loadUndoState: function(index) {
        var changes = this._states[index];
        // iterate in reverse to go backwards
        for(var i = changes.length - 1; i >= 0; i--) {
            var obj = changes[i];
            obj.undo();
        }
    },
    /**
     * Load state for redo
     */
    loadRedoState: function(index) {
        var changes = this._states[index];
        for(var i = 0, len = changes.length; i < len; i++) {
            var obj = changes[i];
            obj.redo();
        }
    },
    /**
     * Do undo
     */
    undo: function() {
        if(this._index in this._states) {
            this._isUndo = true;
            this.loadUndoState(this._index);
            this._index--;
            this._isUndo = false;
        }
    },
    /**
     * Do redo
     */
    redo: function() {
        if(this._states[this._index+1]) {
            this._isRedo = true;
            this.loadRedoState(this._index+1);
            this._index++;
            this._isRedo = false;
        }
    },
    isUndo: function() {
        return this._isUndo;
    },
    isRedo: function() {
        return this._isRedo;
    },
    registerKeyboardShortcuts: function() {
        this._keyboardHandler = Ember.$(document).on('keydown', function(e) {
            if(e.which == 90 && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();

                if(e.shiftKey) {
                    UndoHistory.redo();
                    Ember.$(document).trigger('redo');
                } else {
                    UndoHistory.undo();
                    Ember.$(document).trigger('undo');
                }
                return false;
            }
            return true;
        });
    }
}

Ember.History = Em.Mixin.create({

    //Initiate and add observers for the object properties
    init: function(){
        var retVal = this._super();

        var props = this.get('_trackProperties');
        if(!props) {
            props = [];
            this.constructor.eachComputedProperty(function(name, prop) {
                if(prop.isAttribute || prop.kind === "hasMany") {
                  props.push(name);
                }
            });
        }

        props.forEach(function(item) {
            Ember.addBeforeObserver(this, item, this, '_beforeChange');
            Ember.addObserver(this, item, this, '_afterChange');

            var value = this.get(item);
            if(Ember.typeOf(value) === "array" || Ember.typeOf(value) === "instance") {
                value.addArrayObserver(this);
            }
        }, this);

        this._beforeProps = {};

        return retVal;
    },
    //The before observer saves adds the element with the value it was before the change
    _beforeChange: function(element, prop, value) {
        if(!UndoHistory.isActive()) { return; }

        if(arguments.length == 2) { value = element.get(prop); }
        this._beforeProps[prop] = value;

        // check if the property is an array
        if (Ember.typeOf(value) === 'array' || Ember.typeOf(value) === 'instance') {
            value.removeArrayObserver(this);
        }
    },
    //This method updates the last state and adds the current value
    _afterChange: function(element, prop, value) {
        if(!UndoHistory.isActive()) { return; }

        if(arguments.length == 2) { value = element.get(prop); }

        // check if the property is an array
        if (Ember.typeOf(value) === 'array' || Ember.typeOf(value) === 'instance') {
            value.addArrayObserver(this);
        }

        var before = this._beforeProps[prop];
        delete this._beforeProps[prop];

        if(typeof(before) === "undefined") { return; }

        UndoHistory.pushState({
            element: element,
            property: prop,
            before: before,
            after: value,
            undo: function() { Ember.set(element, prop, before); },
            redo: function() { Ember.set(element, prop, value); },
            timestamp: Date.now()
        });
    },
    //Records array removals
    arrayWillChange: function(array, startIndex, removeCount, addCount) {
        if (removeCount === 0 || !UndoHistory.isActive()) { return; }

        var elements = array.slice(startIndex, startIndex + removeCount);
        UndoHistory.pushState({
            element: array,
            removes: removeCount,
            property: array.name,
            undo: function() {
                array.replace(startIndex, 0, elements);
            },
            redo: function() {
                array.replace(startIndex, removeCount);
            },
            timestamp: Date.now()
        });
    },
    //Records array additions
    arrayDidChange: function(array, startIndex, removeCount, addCount) {
        if (addCount === 0 || !UndoHistory.isActive()) { return; }

        var elements = array.slice(startIndex, startIndex + addCount);
        UndoHistory.pushState({
            element: array,
            property: array.name,
            adds: addCount,
            undo: function() {
                array.replace(startIndex, addCount);
            },
            redo: function() {
                array.replace(startIndex, 0, elements);
            },
            timestamp: Date.now()
        });
    }
});
