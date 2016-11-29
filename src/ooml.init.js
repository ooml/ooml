OOML.init = function(settings) {
	var globals = settings.globals,
		rootElem = settings.rootElem || document.body;

	var classes = {},
		objects = {};

	$(rootElem).find('template[ooml-class]').each(function(classTemplateElem) {
		var $classTemplateElem = $(classTemplateElem);

		var className = $classTemplateElem.attr('ooml-class');
		if (classes[className]) throw new SyntaxError('The class ' + className + ' has already been initialised');

		var localPropertyNames = Object.create(null),
			globalPropertiesMap = Object.create(null),

			localArrayProperties = Object.create(null),
			localElemProperties = Object.create(null);

		var toProcess = $classTemplateElem.import().get();

		// Only use the first element for the class's DOM
		while (!(toProcess[0] instanceof Element)) toProcess.shift();
		toProcess = toProcess.slice(0, 1);

		var rootElemOfClass = toProcess[0],
			current;

		$classTemplateElem.remove();

		while (current = toProcess.shift()) {
			if (current instanceof Element) {
				Utils.pushAll(toProcess, current.attributes, current.childNodes);
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
						localArrayProperties[propName] = elemConstructor;
					} else {
						localElemProperties[propName] = elemConstructor;
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

		localPropertyNames = Object.freeze(Object.keys(localPropertyNames));

		classes[className] = function(initState) {
			var instance = this,
				instanceIsDestructed = false,
				instanceIsAttached = false;

			var localPropertiesMap = {},
				localGlobalPropertiesMap = {}; // For destructuring; to remember what to remove from globalPropertiesMap

			var instancePropertyValues = {};

			var instanceDom = Utils.cloneElemForInstantiation(rootElemOfClass),
				$instanceDom = $(instanceDom),
				toProcess = [instanceDom],
				current;

			while (current = toProcess.shift()) {
				if (current instanceof Element) {
					Utils.pushAll(toProcess, current.attributes, current.childNodes);
					if (current[OOML_NODE_PROPNAME_ELEMSUBSTITUTIONCONFIG]) {
						var config = current[OOML_NODE_PROPNAME_ELEMSUBSTITUTIONCONFIG];
						if (config.isArray) {
							instancePropertyValues[config.propName] = new OOML.Array(config.elemConstructor, $(current));
						} else {
							localPropertiesMap[config.propName] = { elemConstructor: config.elemConstructor, $parent: $(current) };
						}
					}
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

			var propertiesGetterSetterFuncs = {};

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
						newElem.__oomlAttach({appendTo: elemDetails.$parent});

						if (instancePropertyValues[prop]) {
							instancePropertyValues[prop].__oomlDetach();
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
				};
			});

			Object.assign(propertiesGetterSetterFuncs, {
				data: {
					get: function() {
						return instanceDom.dataset;
					},
				},
				__oomlDomElem: {
					value: $instanceDom,
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
							$instanceDom.appendTo(settings.appendTo);
						} else if (settings.insertAfter) {
							$instanceDom.insertAfter(settings.insertAfter);
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

						$instanceDom.remove();
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
						Object.keys(localGlobalPropertiesMap).forEach(function(globalPropName) {
							localGlobalPropertiesMap.forEach(function(nodeToRemove) {
								globalPropertiesMap[globalPropName].delete(nodeToRemove);
							});
						});

						instanceIsDestructed = true;
					},
				}
			});

			Object.defineProperties(this, propertiesGetterSetterFuncs);

			if (initState) Object.assign(this, initState);
		};
		classes[className].__oomlProperties = localPropertyNames;
		classes[className].prototype = Object.create(OOML.Element.prototype);
		classes[className].prototype.constructor = classes[className];
	});

	$(rootElem).find('[ooml-instantiate]').each(function(instanceInstantiationElem) {
		var $instanceInstantiationElem = $(instanceInstantiationElem);

		var instDetails = $instanceInstantiationElem.attr('ooml-instantiate').split(' '),
			className = instDetails[0],
			instanceName = instDetails[1];

		if (objects[instanceName]) throw new SyntaxError('An object already exists with the name ' + instanceName);

		var instance = new classes[className];

		instance.__oomlAttach({ insertAfter: instanceInstantiationElem });

		// Remove after attaching constructed $elem
		$instanceInstantiationElem.remove();

		objects[instanceName] = instance;
	});

	return {
		classes: classes,
		objects: objects,
	};
};