let Utils = {
    DOM: {
        find: (rootElem, sel) => Utils.concat(rootElem.querySelectorAll(sel)),

        setData: (domElem, key, value) => {
            if (OOMLCompatDatasetExists) {
                domElem.dataset[key] = value;
            } else {
                domElem.setAttribute('data-' + Utils.toDashCase(key), value);
            }
        },

        hasAncestorOrDescendantNamespace: rootElem => {
            let toCheck, current;

            toCheck = rootElem;
            while (toCheck) {
                if (toCheck[OOML_DOM_PROPNAME_ISNAMESPACE]) {
                    return true;
                }
                toCheck = toCheck.parentNode;
            }

            toCheck = [rootElem];
            while (current = toCheck.shift()) {
                if (current[OOML_DOM_PROPNAME_ISNAMESPACE]) {
                    return true;
                }
                toCheck.push(current.children);
            }

            return false;
        },

        writeValue: (type, name, nodes, value, customHtml) => {
            let customDom;
            let useCustomHtml = Utils.typeOf(customHtml, TYPEOF_STRING);

            // customHtml may be empty, which means that custom HTML is still wanted (i.e. don't write text value), but remove any current custom HTML
            if (useCustomHtml) {
                let dom = document.createElement('div');
                dom.innerHTML = customHtml.trim();
                if (dom.children.length > 1) {
                    throw new SyntaxError(`Custom HTML has more than one root element`);
                }
                customDom = dom.children[0];
            }

            nodes.forEach(node => {
                if (node instanceof Text) {

                    // Delete any custom HTML, regardless if using or not
                    if (node.nextSibling && node.nextSibling[OOML_DOM_PROPNAME_ISCUSTOMHTML]) {
                        delete node.nextSibling[OOML_DOM_PROPNAME_ISCUSTOMHTML];
                        node.parentNode.removeChild(node.nextSibling);
                    }

                    if (useCustomHtml) {

                        if (customDom) {
                            let customDomDuplicated = customDom.cloneNode(true);
                            customDomDuplicated[OOML_DOM_PROPNAME_ISCUSTOMHTML] = true;

                            node.parentNode.insertBefore(customDomDuplicated, node.nextSibling);
                        }

                        node.data = '';

                    } else {

                        node.data = value;

                    }
                } else { // Must be attribute
                    let formatStr = node.valueFormat;

                    let setToUse;
                    if (type == 'attribute') {
                        setToUse = node.valueFormatMap.attributes[name];
                    } else {
                        setToUse = node.valueFormatMap[name];
                    }
                    setToUse.forEach(offset => {
                        formatStr[offset] = value;
                    });
                    OOMLNodesWithUnwrittenChanges.add(node);
                }
            });

            OOMLWriteChanges();
        },
    },

    typeOf: (value, type) => {
        return typeof value == type;
    },

    iterate: (iterable, iterator) => {
        for (let i = 0; i < iterable.length; i++) {
            iterator(iterable[i], i, iterable);
        }
    },

    hasOwnProperty: (obj, propName) => !!obj && Utils.typeOf(obj, TYPEOF_OBJECT) && Object.prototype.hasOwnProperty.call(obj, propName),

    parseTypeDeclaration: types => types.split('|').filter((type, idx, types) => {
        if (OOMLPropertyTypes.indexOf(type) == -1) {
            throw new SyntaxError(`Invalid type declaration "${ type }"`);
        }
        if (types.indexOf(type) !== idx) {
            throw new SyntaxError(`Duplicate type "${ type }" in type declaration`);
        }

        // There can only be one number type
        // If current type is a number type and there exists another number type...
        if (OOMLPropertyNumberTypes.indexOf(type) > -1 && types.some((t, i) => i != idx && OOMLPropertyNumberTypes.indexOf(t) > -1)) {
            throw new SyntaxError(`Illegal type declaration "${ type }"`);
        }
        return true;
    }),

    deepFreeze: obj => {
        Object.freeze(obj);
        Object.keys(obj).forEach(key => {
            let val = obj[key];
            if (Utils.isObjectLiteral(val) || Array.isArray(val)) {
                Utils.deepFreeze(val);
            }
        });
        return obj;
    },

    isNotOrBlankString: str => !Utils.typeOf(str, TYPEOF_STRING) || !str.trim(),

    parseBindingDeclaration: declaration => {
        let posOfLeftBrace;
        let toProcess = declaration;
        let dynamicParts = [];
        let localPropertyToPartMap = Utils.createCleanObject();
        while ((posOfLeftBrace = toProcess.indexOf('{')) > -1) {
            let upToBrace = toProcess.slice(0, posOfLeftBrace);
            dynamicParts.push(upToBrace);

            toProcess = toProcess.slice(posOfLeftBrace);
            let posOfRightBrace = toProcess.indexOf('}');
            if (posOfRightBrace == -1) {
                throw new SyntaxError(`Malformed binding syntax: "${ toProcess }"`);
            }
            // param === "{{ some.param }}"
            let param = toProcess.slice(0, posOfRightBrace + 2);
            let matches;
            if (!(matches = /^{{ this\.([a-zA-Z0-9_]+) }}$/.exec(param))) {
                throw new SyntaxError(`Malformed binding syntax: "${ declaration }"`);
            }
            let localProperty = matches[1];
            let partId = dynamicParts.push("") - 1;
            if (!localPropertyToPartMap[localProperty]) {
                localPropertyToPartMap[localProperty] = [];
            }
            localPropertyToPartMap[localProperty].push(partId);

            toProcess = toProcess.slice(posOfRightBrace + 2);
        }
        if (toProcess.length) {
            dynamicParts.push(toProcess);
        }

        let isDynamic = dynamicParts.length > 1;
        if (isDynamic) {
            return {
                isDynamic: true,
                parts: dynamicParts,
                propertyToPartMap: localPropertyToPartMap,
            };
        } else {
            return {
                isDynamic: false,
                keypath: dynamicParts[0],
            };
        }
    },

    preprocessClassDeclaration: (templateElem, strictPropertyNames) => {
        let className, classIsAbstract, classExtends;
        // ooml-(abstract)?-class definitely exists as this function is only called via querySelectorAll
        Utils.iterate(templateElem.attributes, attribute => {
            switch (attribute.name) {
                case 'ooml-class':
                case 'ooml-abstract-class':
                    if (className) {
                        throw new ReferenceError(`Duplicate class declaration attribute`);
                    }

                    let classDeclarationParts = /^([a-zA-Z][a-zA-Z.0-9]*)(?: extends ([a-zA-Z][a-zA-Z.0-9]*))?$/.exec(attribute.value);
                    if (!classDeclarationParts) {
                        throw new SyntaxError(`Malformed attribute value for attribute "${ attribute.name }": "${ attribute.value }"`);
                    }

                    className = classDeclarationParts[1];
                    classIsAbstract = attribute.name.indexOf('abstract') > -1;
                    classExtends = classDeclarationParts[2] || undefined;
                    break;

                default:
                    throw new ReferenceError(`Unrecognised "${ attribute.name }" attribute on class declaration`);
            }
        });

        // Get all nodes in template to process
        let templateContent = OOMLCompatTemplateExists ?
            templateElem.content :
            templateElem;

        let classMetadata = {
            name: className,
            isAbstract: classIsAbstract,
            extends: classExtends,

            properties: Utils.createCleanObject(),
            methods: Utils.createCleanObject(),

            constructor: undefined,
            rootElem: undefined,
        };

        Utils.iterate(templateContent.childNodes, node => {

            if (node instanceof Comment) {
                return;
            }

            if (node instanceof Text) {
                if (/\S/.test(node.data)) {
                    throw new TypeError(`Illegal text node in class declaration with value "${node.data}"`);
                }
                return;
            }

            if (!(node instanceof Element)) {
                throw new TypeError(`Illegal top-level node in class declaration`);
            }

            if (classMetadata.rootElem) {
                throw new SyntaxError(`The class "${ classMetadata.name }" has more than one root element`);
            }

            switch (node.nodeName) {
                case 'OOML-PROPERTY':

                    let propName;
                    let propTypes;
                    let isSuppressed = false;
                    let propBindingParts;
                    let propBindingPropertyToPartMap;
                    let propBindingIsDynamic;
                    let propBindingKeypath;
                    let propBindingOnExist;
                    let propBindingOnMissing;

                    let propGetter, propSetter, onchangeListener;

                    Utils.iterate(node.attributes, attr => {
                        let _attrName = attr.name;
                        let _attrVal = attr.value;

                        switch (_attrName) {
                            case 'name':
                                propName = _attrVal;
                                break;

                            case 'type':
                                if (Utils.isNotOrBlankString(_attrVal)) {
                                    throw new SyntaxError(`Invalid type declaration for attribute declared by ooml-property tag`);
                                }
                                propTypes = _attrVal;
                                break;

                            case 'suppressed':
                                if (_attrVal !== '') {
                                    throw new SyntaxError(`Invalid suppressed value for attribute declared by ooml-property tag`);
                                }
                                isSuppressed = true;
                                break;

                            case 'get':
                                if (Utils.isNotOrBlankString(_attrVal)) {
                                    throw new SyntaxError(`Invalid ${ _attrName } function`);
                                }

                                propGetter = Function('classes', 'property', 'currentValue', 'dispatch', `"use strict";${ _attrVal }`);
                                break;

                            case 'set':
                                if (Utils.isNotOrBlankString(_attrVal)) {
                                    throw new SyntaxError(`Invalid ${ _attrName } function`);
                                }

                                propSetter = Function('classes', 'property', 'currentValue', 'newValue', 'dispatch', `"use strict";${ _attrVal }`);
                                break;

                            case 'change':
                                if (Utils.isNotOrBlankString(_attrVal)) {
                                    throw new SyntaxError(`Invalid ${ _attrName } function`);
                                }

                                onchangeListener = Function('classes', 'property', 'value', 'initial', 'dispatch', `"use strict";${ _attrVal }`);
                                break;

                            case 'bind-to':
                                if (Utils.isNotOrBlankString(_attrVal)) {
                                    throw new SyntaxError(`Invalid binding`);
                                }

                                let bindingConfig = Utils.parseBindingDeclaration(_attrVal.trim());
                                propBindingIsDynamic = bindingConfig.isDynamic;
                                propBindingParts = bindingConfig.parts;
                                propBindingPropertyToPartMap = bindingConfig.propertyToPartMap;
                                propBindingKeypath = bindingConfig.keypath;
                                break;

                            // TODO Change to dash-case
                            case 'bindonexist':
                                if (Utils.isNotOrBlankString(_attrVal)) {
                                    throw new SyntaxError(`Invalid ${ _attrName } function`);
                                }

                                propBindingOnExist = Function('classes', 'property', 'storeValue', 'initial', 'dispatch', 'event', `"use strict";${ _attrVal }`);
                                break;

                            case 'bindonmissing':
                                if (Utils.isNotOrBlankString(_attrVal)) {
                                    throw new SyntaxError(`Invalid ${ _attrName } function`);
                                }

                                // storeValue needs to be available, even though it's always undefined
                                propBindingOnMissing = Function('classes', 'property', 'storeValue', 'initial', 'dispatch', 'event', `"use strict";${ _attrVal }`);
                                break;

                            default:
                                throw new ReferenceError(`Unrecognised attribute "${ _attrName }" on ooml-property tag`);
                        }
                    });

                    if (!Utils.isValidPropertyName(propName, strictPropertyNames)) {
                        throw new SyntaxError(`The property name "${ propName }" is invalid`);
                    }

                    if (classMetadata.properties[propName] || classMetadata.methods[propName]) {
                        throw new ReferenceError(`A property or method called "${ propName }" already exists`);
                    }

                    if (propTypes) {
                        propTypes = Utils.parseTypeDeclaration(propTypes);
                    }

                    let propValue = Utils.getEvalValue(node.textContent);
                    if (!Utils.isPrimitiveValue(propValue) || (propTypes && !Utils.isType(propTypes, propValue))) {
                        throw new TypeError(`The value for the property "${ propName }" is invalid`);
                    }

                    classMetadata.properties[propName] = {
                        bindingIsDynamic: propBindingIsDynamic,
                        bindingParts: propBindingParts,
                        bindingPropertyToPartMap: propBindingPropertyToPartMap,
                        bindingKeypath: propBindingKeypath,
                        bindingOnExist: propBindingOnExist,
                        bindingOnMissing: propBindingOnMissing,
                        types: propTypes,
                        value: propValue,
                        isArray: false,
                        onchange: onchangeListener,
                        getter: propGetter,
                        setter: propSetter,
                        suppressed: isSuppressed,
                    };

                    break;

                case 'OOML-METHOD':

                    let methodName;

                    Utils.iterate(node.attributes, attr => {
                        let attrVal = attr.value;
                        switch (attr.name) {
                            case 'name':
                                methodName = attrVal;
                                break;

                            default:
                                throw new ReferenceError(`Unrecognised attribute "${ attr.name }" on ooml-method tag`);
                        }
                    });

                    if (!Utils.isValidPropertyName(methodName, strictPropertyNames)) {
                        throw new SyntaxError(`The method name "${ methodName }" is invalid`);
                    }

                    let textContent = node.textContent.trim();

                    if (!/^function *\((?:[a-zA-Z_][a-zA-Z0-9_]*,)*(?:[a-zA-Z_][a-zA-Z0-9_]*)*\)\s*\{/.test(textContent) || !/\}$/.test(textContent)) {
                        throw new SyntaxError(`The "${ methodName }" method for the class "${ classMetadata.name }" is not a valid function declaration`);
                    }

                    let realFn = Utils.getEvalValue(textContent);

                    // Abstract methods can also have constructors, as descendant classes can call it
                    if (methodName == 'constructor') {
                        if (classMetadata.constructor) {
                            throw new ReferenceError(`A constructor has already been defined for the class "${ classMetadata.name }"`);
                        }

                        classMetadata.constructor = realFn;
                    } else {
                        if (classMetadata.methods[methodName] || classMetadata.properties[methodName]) {
                            throw new ReferenceError(`A method or property called "${ methodName }" already exists`);
                        }
                        Object.defineProperty(realFn, "name", { value: methodName });

                        classMetadata.methods[methodName] = {
                            fn: realFn,
                        };
                    }

                    break;

                default:
                    classMetadata.rootElem = node;
            }
        });

        if (!classMetadata.rootElem && !classMetadata.isAbstract) {
            throw new SyntaxError(`The class "${ classMetadata.name }" does not have a root element`);
        }


        if (templateElem.parentNode) {
            templateElem.parentNode.removeChild(templateElem);
        }

        return classMetadata;
    },

    isValidPropertyName: (name, strictMode) =>
        Utils.typeOf(name, TYPEOF_STRING) &&
        !!name.length &&
        name[0] != '$' &&
        // Double underscore prefix
        !(name[0] == '_' && name[1] == '_') &&
        // Starting or trailing whitespace
        !/^\s|\s$/.test(name) &&
        OOMLReservedPropertyNames.indexOf(name) == -1 &&
        (!strictMode || /^[a-z][a-zA-Z0-9_]*$/.test(name)),

    // ${str} is always a non-empty string
    toDashCase: str => dashCaseCache[str] || (dashCaseCache[str] = str.replace(/^[a-z]+|(?!^)(?:[A-Z][a-z]*)/g, match => match.toLowerCase() + '-').slice(0, -1)),

    // Must be used only with strings (usually .textContent)
    getEvalValue: codeStr => Function(`"use strict";return ${ codeStr.trim() || undefined }`)(),

    getDefaultPrimitiveValueForTypes: types => {
        if (!types || ~types.indexOf('null')) {
            return null;
        } else if (~types.indexOf('natural') || ~types.indexOf('integer') || ~types.indexOf('float') || ~types.indexOf('number')) {
            return 0;
        } else if (~types.indexOf('boolean')) {
            return false;
        } else if (~types.indexOf('string')) {
            return '';
        } else {
            throw new Error(`Unknown type "${types}"`);
        }
    },

    clone: obj => {
        let cloned;
        if (Utils.isObjectLiteral(obj)) {
            cloned = Utils.createCleanObject();
            Object.keys(obj).forEach(key => {
                cloned[key] = Utils.clone(obj[key]);
            });
        } else if (Array.isArray(obj)) {
            cloned = obj.map(item => Utils.clone(item));
        } else {
            cloned = obj;
        }
        return cloned;
    },

    // Use full function declaration for "arguments" object
    concat: function() {
        let ret;

        if (Utils.isObjectLiteral(arguments[0])) {
            ret = Utils.createCleanObject();
            for (let i = 0; i < arguments.length; i++) {
                let obj = arguments[i];
                if (Utils.isObjectLiteral(obj)) {
                    Object.keys(obj).forEach(function(prop) {
                        ret[prop] = obj[prop];
                    });
                }
            }
        } else {
            // WARNING: Don't use .concat as that doesn't work with array-like objects
            // e.g. [].concat(NodeList(div, span)) becomes [NodeList], not [div, span]
            ret = Array.prototype.slice.call(arguments[0]);
            for (let i = 1; i < arguments.length; i++) {
                if (arguments[i] && arguments[i].length) {
                    Array.prototype.push.apply(ret, arguments[i]);
                }
            }
        }
        return ret;
    },

    isOOMLClass: c => Utils.typeOf(c, TYPEOF_FUNCTION) && c.prototype instanceof OOML.Element,

    isPrimitiveValue: val => Utils.isType(OOMLPrimitiveTypes, val),

    // typeof null == 'object'
    // Use typeof as .getPrototypeOf can't be used with non-objects
    // Object.create(null) is NOT instanceof Object, so don't use instanceof
    isObjectLiteral: (obj) => !!obj && Utils.typeOf(obj, TYPEOF_OBJECT) && (obj.constructor == Object || Object.getPrototypeOf(obj) === null),

    isType: (type, value) => {
        if (Array.isArray(type)) {
            return type.some(t => Utils.isType(t, value));
        }
        switch (type) {
            case 'null':
                return value === null;

            case 'number':
            case 'boolean':
            case 'string':
            case 'function':
                return typeof value == type;

            case 'natural':
            case 'integer':
                return Utils.typeOf(value, TYPEOF_NUMBER) &&
                    isFinite(value) &&
                    Math.floor(value) === value &&
                    (type != 'natural' || value >= 0);

            case 'float':
                // Floats can have zero remainder, as there is no real difference between int and float in JS
                return Utils.typeOf(value, TYPEOF_NUMBER) &&
                    isFinite(value); // Returns false on NaN and +/-Infinity

            case 'Object':
                return Utils.isObjectLiteral(value);

            case 'Array':
                return Array.isArray(value);

            default:
                throw new Error(`Unrecognised type for checking against`);
        }
    },

    createCleanObject: () => Object.create(null),

    constructElement: (elemConstructor, obj) => {
        if (obj instanceof elemConstructor) {
            return obj;
        }
        // Don't check obj's type or if elemConstructor is OOML.Element; this will be handled by the constructor

        return new elemConstructor(obj);
    },
};
