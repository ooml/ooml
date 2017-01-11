/*
    MUTATION
*/
let OOMLArrayProtoMutation = Utils.createCleanObject();
OOMLArrayProtoMutation.initialize = function(arr) {
    var elemConstructor = this[OOML_ARRAY_PROPNAME_ELEMCONSTRUCTOR],
        insertAfter = this[OOML_ARRAY_PROPNAME_INSERTAFTERDOMELEM],
        that = this;

    arr = arr.map(function(elem) {
        return Utils.constructElement(elemConstructor, elem);
    });

    this[OOML_ARRAY_PROPNAME_INTERNALARRAY].forEach(function(elemToDetach) {
        elemToDetach[OOML_INSTANCE_PROPNAME_DETACH]();
    });
    arr.reduce(function(previousElem, elemToAttach) {
        elemToAttach[OOML_INSTANCE_PROPNAME_ATTACH]({ insertAfter: previousElem, parent: that });
        return elemToAttach[OOML_INSTANCE_PROPNAME_DOMELEM];
    }, insertAfter);

    this[OOML_ARRAY_PROPNAME_INTERNALARRAY] = arr;

    return this;
};

OOMLArrayProtoMutation.pop = function() {
    var arr = this[OOML_ARRAY_PROPNAME_INTERNALARRAY];

    var instanceToDetach = arr.pop();
    if (instanceToDetach) {
        instanceToDetach[OOML_INSTANCE_PROPNAME_DETACH]();
    }

    return instanceToDetach;
};

OOMLArrayProtoMutation.push = function(newVal) {
    var arr = this[OOML_ARRAY_PROPNAME_INTERNALARRAY],
        insertAfter = arr[arr.length - 1] ? arr[arr.length - 1][OOML_INSTANCE_PROPNAME_DOMELEM] : this[OOML_ARRAY_PROPNAME_INSERTAFTERDOMELEM];

    var elemConstructor = this[OOML_ARRAY_PROPNAME_ELEMCONSTRUCTOR];
    var newElem = Utils.constructElement(elemConstructor, newVal);
    newElem[OOML_INSTANCE_PROPNAME_ATTACH]({ insertAfter: insertAfter, parent: this });

    arr.push(newElem);

    return this.length;
};

OOMLArrayProtoMutation.reverse = function() {
    var arr = this[OOML_ARRAY_PROPNAME_INTERNALARRAY],
        lastElem = arr[arr.length - 1][OOML_INSTANCE_PROPNAME_DOMELEM];

    for (var i = 0; i < this.length - 1; i++) {
        var node = arr[i][OOML_INSTANCE_PROPNAME_DOMELEM];
        node.parentNode.insertBefore(node, lastElem.nextSibling);
    }

    arr.reverse();

    return this;
};

OOMLArrayProtoMutation.shift = function() {
    var arr = this[OOML_ARRAY_PROPNAME_INTERNALARRAY];

    var instanceToDetach = arr.shift();
    if (instanceToDetach) {
        instanceToDetach[OOML_INSTANCE_PROPNAME_DETACH]();
    }

    return instanceToDetach;
};

OOMLArrayProtoMutation.sort = function(propName, ascending) {
    if (ascending == undefined) {
        ascending = true;
    }
    var ascendingMultiplier = ascending ? 1 : -1;

    var sorted = this[OOML_ARRAY_PROPNAME_INTERNALARRAY].sort(function(a, b) {
        if (a[propName] < b[propName]) {
            return -1 * ascendingMultiplier;
        } else if (a[propName] === b[propName]) {
            return 0;
        } else {
            return 1 * ascendingMultiplier;
        }
    });

    var insertAfter = this[OOML_ARRAY_PROPNAME_INSERTAFTERDOMELEM];

    sorted.reduce(function(previousElem, elem) {
        previousElem.parentNode.insertBefore(elem[OOML_INSTANCE_PROPNAME_DOMELEM], previousElem.nextSibling);
        return elem[OOML_INSTANCE_PROPNAME_DOMELEM];
    }, insertAfter);

    this[OOML_ARRAY_PROPNAME_INTERNALARRAY] = sorted;
};

OOMLArrayProtoMutation.splice = function(start, deleteCount) {
    var arr = this[OOML_ARRAY_PROPNAME_INTERNALARRAY],
        elemConstructor = this[OOML_ARRAY_PROPNAME_ELEMCONSTRUCTOR];

    for (var i = 2; i < arguments.length; i++) {
        arguments[i] = Utils.constructElement(elemConstructor, arguments[i]);
    }

    var spliced = Array.prototype.splice.apply(arr, arguments);
    spliced.forEach(function(elem) {
        if (elem) {
            elem[OOML_INSTANCE_PROPNAME_DETACH]();
        }
    });

    return spliced;
};

OOMLArrayProtoMutation.unshift = function(newVal) {
    var arr = this[OOML_ARRAY_PROPNAME_INTERNALARRAY],
        insertAfter = this[OOML_ARRAY_PROPNAME_INSERTAFTERDOMELEM];

    var elemConstructor = this[OOML_ARRAY_PROPNAME_ELEMCONSTRUCTOR];
    var newElem = Utils.constructElement(elemConstructor, newVal);
    newElem[OOML_INSTANCE_PROPNAME_ATTACH]({ insertAfter: insertAfter, parent: this });

    arr.unshift(newElem);

    return this.length;
};
for (let methodName in OOMLArrayProtoMutation) {
    OOMLArrayProto[methodName] = function() {
        let _this = this;
        OOMLArrayProtoMutation[methodName].apply(_this, arguments);
        _this[OOML_ARRAY_PROPNAME_MUTATIONEVENTLISTENERS].arraychange.forEach(handler => {
            handler.call(_this);
        });
    };
}
