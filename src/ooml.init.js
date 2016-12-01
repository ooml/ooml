OOML.init = function(settings) {
	var globals = settings.globals,
		rootElem = settings.rootElem || document.body;

	var classes = Object.create(null),
		objects = Object.create(null);

	if (typeof rootElem == "string") rootElem = document.querySelector(rootElem);

	Utils.DOM.find(rootElem, 'template[ooml-class]').forEach(function(classTemplateElem) {

		var className = classTemplateElem.getAttribute('ooml-class');
		if (classes[className]) throw new SyntaxError('The class ' + className + ' has already been initialised');

		var localPropertyNames = Object.create(null),
			globalPropertiesMap = Object.create(null),

			localArrayProperties = Object.create(null), // Used to check for duplicates as well as in setters in instance proerties
			localElemProperties = Object.create(null); // Used to check for duplicates as well as in setters in instance properties

		var toProcess = Utils.merge(document.importNode(classTemplateElem.content, true).childNodes);

		// Only use the first element for the class's DOM tree
		while (toProcess.length && !(toProcess[0] instanceof Element)) toProcess.shift();
		if (!toProcess.length) throw new SyntaxError('The class ' + className + ' is empty');
		toProcess = [toProcess[0]];

		var rootElemOfClass = toProcess[0],
			current;

		classTemplateElem.parentNode.removeChild(classTemplateElem);

		while (current = toProcess.shift()) {
			if (current instanceof Element) {

				for (var i = 0; i < current.attributes.length; i++) {
					var attr = current.attributes[i];
					if (attr.name.indexOf('on') === 0) {
						if (!current[OOML_NODE_PROPNAME_GENERICEVENTHANDLERS]) current[OOML_NODE_PROPNAME_GENERICEVENTHANDLERS] = {};
						current[OOML_NODE_PROPNAME_GENERICEVENTHANDLERS][attr.name] = Function('globals', 'event', attr.nodeValue);
						current.removeAttributeNode(attr);
					} else {
						toProcess.push(attr);
					}
				}

				Utils.pushAll(toProcess, current.childNodes);
			} else if (current instanceof Attr || current instanceof Text) {

				var nodeValue = current.nodeValue,
					regexpMatches,
					elemConstructorName,
					elemConstructor,
					isArraySubstitution,
					propName;

				if (current instanceof Text && current.parentNode.childNodes.length == 1 &&
					((regexpMatches = / *\{ *for ([A-Za-z0-9._]+) of this\.([A-Za-z0-9_]+) *(\}) */.exec(nodeValue)) ||
					(regexpMatches = / *\{ *([A-Za-z0-9._]+) this\.([A-Za-z0-9_]+) *\} */.exec(nodeValue)))
				) {

					// Match element substitution
					elemConstructorName = regexpMatches[1];
					propName = regexpMatches[2];
					isArraySubstitution = !!regexpMatches[3];

					if (localPropertyNames[propName]) {
						throw new SyntaxError('The property ' + propName + ' is already defined');
					}

					localPropertyNames[propName] = true;
					elemConstructor =
						elemConstructorName == 'HTMLElement' ? HTMLElement :
						elemConstructorName == 'OOML.Element' ? OOML.Element :
						elemConstructorName.indexOf('.') == -1 ? classes[elemConstructorName] :
						(function() {
							var parts = elemConstructorName.split('.'),
								elemConstructor = globals,
								part;

							while (part = parts.shift()) {
								elemConstructor = elemConstructor[part];
							}

							return elemConstructor;
						})();

					if (typeof elemConstructor != "function") {
						throw new TypeError(elemConstructorName + ' is not a valid class');
					}

					if (isArraySubstitution) {
						localArrayProperties[propName] = true;
					} else {
						localElemProperties[propName] = true;
					}

					current.parentNode[OOML_NODE_PROPNAME_ELEMSUBSTITUTIONCONFIG] = { elemConstructor: elemConstructor, propName: propName, isArray: isArraySubstitution };
					current.parentNode.removeChild(current);

				} else if (nodeValue.indexOf('{{') > -1) {

					var paramsData = Utils.splitStringByParamholders(nodeValue);
					current[OOML_NODE_PROPNAME_TEXTFORMAT] = paramsData.parts;
					current[OOML_NODE_PROPNAME_FORMATPARAMMAP] = paramsData.map;

					Object.keys(paramsData.map).forEach(function(fullPropName) { // Use Object.keys to avoid scope issues
						var propNameParts = fullPropName.split('.');
						if (propNameParts[0] == 'this') {
							localPropertyNames[propNameParts[1]] = true;
						} else if (!globalPropertiesMap[fullPropName]) {
							globalPropertiesMap[fullPropName] = new Set();
							var objectToWatch = globals[propNameParts.shift()],
								_,
								endPropertyName = propNameParts.pop();

							while (_ = propNameParts.shift()) {
								objectToWatch = objectToWatch[_];
							}

							var d = Object.getOwnPropertyDescriptor(objectToWatch, endPropertyName);
							if (!d.set) {
								var globalPropertyValueHolder = objectToWatch[endPropertyName]; // Needed otherwise property won't be set due to setter but no getter
								Object.defineProperty(objectToWatch, endPropertyName, {
									get: function() {
										return globalPropertyValueHolder;
									},
									set: function setter(newVal) {
										setter.__oomlListeners.forEach(function(listener) {
											listener.call(objectToWatch, fullPropName, newVal);
										});
										globalPropertyValueHolder = newVal;
									},
								});
								d = Object.getOwnPropertyDescriptor(objectToWatch, endPropertyName); // Refresh to get newly set setter
								d.set.__oomlListeners = [];
							}

							d.set.__oomlListeners.push(function(fullPropName, newVal) {

								globalPropertiesMap[fullPropName].forEach(function(node) {

									var formatStr = node[OOML_NODE_PROPNAME_TEXTFORMAT];
									node[OOML_NODE_PROPNAME_FORMATPARAMMAP][fullPropName].forEach(function(offset) {
										formatStr[offset] = newVal;
									});

									OOMLNodesWithUnwrittenChanges.add(node);
								});

								OOMLWriteChanges();
							});
						}
					});

				}
			}
		}

		// Don't Object.freeze this as it's unnecessary
		localPropertyNames = Object.keys(localPropertyNames);

		classes[className] = function(initState) {
			var instance = this,
				instanceIsDestructed = false,
				instanceIsAttached = false;

			var localPropertiesMap = Object.create(null),
				localGlobalPropertiesMap = Object.create(null); // For destructuring; to remember what to remove from globalPropertiesMap

			var instancePropertyValues = Object.create(null),
				instanceExposedDOMElems = {}; // { "key": HTMLElement }

			var instanceDom = Utils.cloneElemForInstantiation(rootElemOfClass),
				toProcess = [instanceDom],
				current;

			while (current = toProcess.shift()) {
				if (current instanceof Element) {

					if (current[OOML_NODE_PROPNAME_ELEMSUBSTITUTIONCONFIG]) {
						var config = current[OOML_NODE_PROPNAME_ELEMSUBSTITUTIONCONFIG];
						if (config.isArray) {
							instancePropertyValues[config.propName] = new OOML.Array(config.elemConstructor, current);
						} else {
							localPropertiesMap[config.propName] = { elemConstructor: config.elemConstructor, parent: current };
						}
					}

					if (current[OOML_NODE_PROPNAME_GENERICEVENTHANDLERS]) {
						Object.keys(current[OOML_NODE_PROPNAME_GENERICEVENTHANDLERS]).forEach(function(eventName) {
							current[eventName] = current[OOML_NODE_PROPNAME_GENERICEVENTHANDLERS][eventName].bind(instance, globals); // event object will be provided when called by browser
						});
					}

					var exposeKey = current.getAttribute('ooml-expose');
					if (exposeKey) {
						if (instanceExposedDOMElems[exposeKey]) throw new SyntaxError('A DOM element is already exposed with the key ' + exposeKey);
						instanceExposedDOMElems[exposeKey] = current;
						current.removeAttribute('ooml-expose');
					}

					Utils.pushAll(toProcess, current.attributes, current.childNodes);

				} else if (current instanceof Attr || current instanceof Text) {
					if (current[OOML_NODE_PROPNAME_FORMATPARAMMAP]) {
						for (var propName in current[OOML_NODE_PROPNAME_FORMATPARAMMAP]) {
							if (propName.indexOf('this.') === 0) {
								propName = propName.slice(5);
								if (!localPropertiesMap[propName]) {
									localPropertiesMap[propName] = [];
								}
								localPropertiesMap[propName].push(current);
							} else {
								globalPropertiesMap[propName].add(current);
								if (!localGlobalPropertiesMap[propName]) {
									localGlobalPropertiesMap[propName] = [];
								}
								localGlobalPropertiesMap[propName].push(current);
							}
						}
					}
				}
			}

			var propertiesGetterSetterFuncs = {
				data: {
					value: instanceDom.dataset,
				},
				__oomlDomElem: {
					value: instanceDom,
				},
				__oomlAttach: {
					value: function(settings) {
						if (instanceIsDestructed) {
							OOMLInstanceDestructedError();
						}

						if (instanceIsAttached) {
							throw new Error('This instance is already in use');
						}

						if (settings.appendTo) {
							settings.appendTo.appendChild(instanceDom);
						} else if (settings.prependTo) {
							settings.prependTo.insertBefore(instanceDom, settings.prependTo.childNodes[0] || null);
						} else if (settings.insertAfter) {
							settings.insertAfter.parentNode.insertBefore(instanceDom, settings.insertAfter.nextSibling);
						}

						instanceIsAttached = true;
					},
				},
				__oomlDetach: {
					value: function() {
						if (instanceIsDestructed) {
							OOMLInstanceDestructedError();
						}

						if (!instanceIsAttached) {
							throw new Error('This instance is not in use');
						}

						instanceDom.parentNode.removeChild(instanceDom);
						instanceIsAttached = false;
					},
				},
				__oomlDestruct: {
					value: function() {
						if (instanceIsDestructed) {
							throw new InternalError('Attempted to destruct already-destructed instance');
						}

						var thisInstance = this;

						// Detach if not already detached
						if (instanceIsAttached) {
							thisInstance.__oomlDetach();
						}

						// Reject getting and setting local properties
						localPropertyNames.forEach(function(prop) {
							Object.defineProperty(thisInstance, prop, {
								get: OOMLInstanceDestructedError,
								set: OOMLInstanceDestructedError,
							});
						});

						// Remove nodes from globalPropertiesMap
						for (var globalPropName in localGlobalPropertiesMap) {
							localGlobalPropertiesMap[globalPropName].forEach(function(nodeToRemove) {
								globalPropertiesMap[globalPropName].delete(nodeToRemove);
							});
						}

						instanceIsDestructed = true;
					},
				},
			};

			localPropertyNames.forEach(function(prop) {

				var setter;

				if (localArrayProperties[prop]) {
					setter = function(newVal) {
						instancePropertyValues[prop].initialize(newVal);
					};
				} else if (localElemProperties[prop]) {
					setter = function(newVal) {
						var elemDetails = localPropertiesMap[prop];

						// Attach first to ensure that element is attachable
						var newElem = Utils.constructElement(elemDetails.elemConstructor, newVal);
						newElem.__oomlAttach({appendTo: elemDetails.parent});

						// Element may not be OOML.Element and therefore may not need destructing
						if (instancePropertyValues[prop] && instancePropertyValues[prop].__oomlDestruct) {
							instancePropertyValues[prop].__oomlDestruct();
						}

						instancePropertyValues[prop] = newElem;
					};
				} else {
					setter = function(newVal) {
						if (!Utils.isPrimitiveValue(newVal)) {
							newVal = '' + newVal;
						}

						localPropertiesMap[prop].forEach(function(node) {
							var formatStr = node[OOML_NODE_PROPNAME_TEXTFORMAT];
							node[OOML_NODE_PROPNAME_FORMATPARAMMAP]['this.' + prop].forEach(function(offset) {
								formatStr[offset] = newVal;
							});
							OOMLNodesWithUnwrittenChanges.add(node);
						});

						OOMLWriteChanges();

						instancePropertyValues[prop] = newVal;
					};
				}

				propertiesGetterSetterFuncs[prop] = {
					get: function() {
						return instancePropertyValues[prop];
					},
					set: setter,
					enumerable: true,
					configurable: true, // For updating get/set on destruct
				};
			});

			Object.keys(instanceExposedDOMElems).forEach(function(keyName) {
				propertiesGetterSetterFuncs['$' + keyName] = {
					value: instanceExposedDOMElems[keyName],
				};
			});

			Object.defineProperties(this, propertiesGetterSetterFuncs);

			// This works, as instances are constructed AFTER classes are initialised (including prototypes)
			if (initState) this.assign(initState);
		};
		classes[className].__oomlProperties = localPropertyNames;
		classes[className].prototype = Object.create(OOML.Element.prototype);
		classes[className].prototype.constructor = classes[className];
	});

	Utils.DOM.find(rootElem, '[ooml-instantiate]').forEach(function(instanceInstantiationElem) {

		var instDetails = instanceInstantiationElem.getAttribute('ooml-instantiate').split(' '),
			className = instDetails[0],
			instanceName = instDetails[1];

		if (objects[instanceName]) throw new SyntaxError('An object already exists with the name ' + instanceName);

		var instance = new classes[className];

		instance.__oomlAttach({ insertAfter: instanceInstantiationElem });

		// Remove after attaching constructed elem
		instanceInstantiationElem.parentNode.removeChild(instanceInstantiationElem);

		objects[instanceName] = instance;
	});

	return {
		classes: classes,
		objects: objects,
	};
};