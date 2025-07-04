import { SchemaJson, ActionType, CommonType, EntityType, Type, TypeOfAttribute } from "@cedar-policy/cedar-wasm";
import { OpenAPIV3 } from 'openapi-types';
import { get, cloneDeep } from 'lodash';
import { CedarOpenAPIExtension, SUPPORTED_HTTP_METHODS, StringifiedSchema } from ".";



type AuthMapping = SimpleRestAuthMapping;

export type MappingType = 'SimpleRest';

export interface SimpleRestAuthMapping {
    mappingType: MappingType;
    schemaV2: string;
    schemaV4: string;
}

export interface GenerateSchemaFromOpenApiSpecOptions {
    openApiSpec: OpenAPIV3.Document;
    namespace: string;
    mappingType: MappingType;
    basePath?: string;
}

export class Tools {
    private static openAPIToCedarPrimitiveTypeMap = {
        string: {type: 'String' as const},
        number: {type: 'Long' as const},
        integer: {type: 'Long' as const},
        boolean: {type: 'Boolean' as const},
    }
    private static sanitizePath(pathStr: string): string {
        const trimmed = pathStr.split('/')
            .map(segment => segment.trim())
            .filter(segment => segment !== '');
        return `/${trimmed.join('/')}`;
    }
    /**
     * How action names are computed:
     *  - If your API spec has operation id's then those are used as cedar actions
     *  - Otherwise the action name is the http verb and the path template
     * How resource names are computed:
     *  - For the SimpleRest mapping type, the resource is always {namespace}::Application::"{namespace}"
     * @param options of type GenerateSchemaFromOpenApiSpecOptions. Includes openApiSpec, namespace, mappingType
     * @returns 
     */
    public static generateApiMappingSchemaFromOpenAPISpec(options: GenerateSchemaFromOpenApiSpecOptions): AuthMapping {
        const {openApiSpec, namespace, mappingType} = options;
        if (!openApiSpec.paths) {
            throw new Error('Invalid OpenAPI spec - missing paths object');
        }
        
        if (!namespace) {
            throw new Error('Invalid input - missing namespace');
        }
        const servers = openApiSpec.servers;

        if (options.basePath && Array.isArray(servers)) {
            const basePathExistsInServersArray = servers
                .map(server => server.url || '')
                .some(serverUrl => {
                    const normalizedBasePath = this.sanitizePath(options.basePath || '');
                    return serverUrl.endsWith(normalizedBasePath) || serverUrl.endsWith(`${normalizedBasePath}/`)
                });
            if (!basePathExistsInServersArray) {
                throw new Error('Base Path option was provided but it does not match any of the `servers` entries in the API spec.');
            }
        }

        let basePath = '';
        if (Array.isArray(servers)) {
            if (servers.length > 1) {
                if (!options.basePath) {
                    throw new Error('Invalid input. API spec specifies more than one `server` entry. Server Base Path parameter required for disambiguation.');
                }
                basePath = this.sanitizePath(options.basePath);
            } else if (servers.length === 1) {
                const fullBaseUrl = new URL(servers[0].url);
                basePath = this.sanitizePath(fullBaseUrl.pathname);
            }
        }
        
    
        const RESERVED_WORDS = ['if', 'in', 'is', '__cedar']; 
        const schemaNamespaceRegex = /^[_a-zA-Z][_a-zA-Z0-9]*(?:::(?:[_a-zA-Z][_a-zA-Z0-9]*))*$/;
        
        if (!schemaNamespaceRegex.test(namespace) || RESERVED_WORDS.includes(namespace.toLowerCase())) {
            throw new Error('Invalid namespace format. Namespace must start with a letter or underscore (_), and can include alphanumeric characters and underscores. Double colons (::) can separate components, where each component must start with a letter or underscore. Reserved words cannot be used as namespaces.');
        }

        const schemaNoMappings: SchemaJson<string> = {
            [namespace]: {
                entityTypes: {
                    User: {
                        shape: {
                            attributes: {},
                            type: 'Record',
                        },
                        memberOfTypes: ['UserGroup'],
                    },
                    UserGroup: {
                        shape: {
                            attributes: {},
                            type: 'Record',
                        },
                    },
                    Application: {
                        shape: {
                            attributes: {},
                            type: 'Record',
                        },
                    },
                },
                actions: {},
            },
        };
        const schemaWithMappings = cloneDeep(schemaNoMappings);
        schemaWithMappings[namespace].annotations = {
            mappingType,
        };
        const paths = Object.keys(openApiSpec.paths);

        const resourcesThatNeedToBeAddedToSchema: Set<string> = new Set();
        for (const httpPathTemplate of paths) {
            const pathDef = openApiSpec.paths?.[httpPathTemplate];
            if (!pathDef || typeof pathDef !== 'object') {
                continue;
            }
            let pathVerbs = Object.keys(pathDef);
            if (pathVerbs.includes('x-amazon-apigateway-any-method')) {
                pathVerbs = SUPPORTED_HTTP_METHODS;
            }
            
            for (const httpVerb of pathVerbs) {
                if (!(<string[]>SUPPORTED_HTTP_METHODS).includes(httpVerb)) {
                    // don't create cedar actions for OPTIONS if present
                    continue;
                }
                const operationObject: OpenAPIV3.OperationObject<CedarOpenAPIExtension> = get(pathDef, httpVerb);
                if (!operationObject) {
                    continue;
                }
                const httpPathTemplateWithBasePath = `${basePath}${httpPathTemplate}`;
                const {actionName, actionDefinition} = Tools.generateActionDefinitionFromOperationObject(
                    httpVerb,
                    httpPathTemplate,
                    operationObject
                );
                
                Object.assign(schemaNoMappings[namespace].actions, { [actionName]: actionDefinition });
                Object.assign(schemaWithMappings[namespace].actions, {
                    [actionName]: {
                        ...actionDefinition,
                        annotations: {
                            httpVerb,
                            httpPathTemplate: httpPathTemplateWithBasePath,
                        }
                    },

                });
                for (const resourceTypeName of actionDefinition.appliesTo?.resourceTypes || []) {
                    const resourceTypeNameNoNamespace = resourceTypeName.split('::').slice(-1)[0];
                    if (!schemaNoMappings[namespace].entityTypes[resourceTypeNameNoNamespace]) {
                        resourcesThatNeedToBeAddedToSchema.add(resourceTypeNameNoNamespace);
                    }
                }
            }
        }
        // now that we've added all the actions, let's process all the openapi schemas from the api spec,
        // and add any resource types that need to be added to the schema
        const commonTypes: Record<string, CommonType<string>> = Tools.convertOpenApiSchemasToCommonTypes(
            openApiSpec.components?.schemas || {}
        );
        Object.assign(schemaNoMappings[namespace], {commonTypes});
        Object.assign(schemaWithMappings[namespace], {commonTypes});

        // add the resources
        const additionalResourcesAsCedar = Tools.buildAdditionalResourceTypesMap(
            openApiSpec,
            resourcesThatNeedToBeAddedToSchema
        );
        schemaNoMappings[namespace].entityTypes = {
            ...schemaNoMappings[namespace].entityTypes,
            ...additionalResourcesAsCedar
        };
        schemaWithMappings[namespace].entityTypes = {
            ...schemaWithMappings[namespace].entityTypes,
            ...additionalResourcesAsCedar
        };

        // if they have a User CommonType, use that for the User entity:
        if (commonTypes.User) {
            schemaNoMappings[namespace].entityTypes.User = {
                shape: {type: 'User'},
                memberOfTypes: ['UserGroup'],
            };
            schemaWithMappings[namespace].entityTypes.User = {
                shape: {type: 'User'},
                memberOfTypes: ['UserGroup'],
            };
        }

        return {
            mappingType,
            schemaV2: JSON.stringify(schemaNoMappings, null, 2),
            schemaV4: JSON.stringify(schemaWithMappings, null, 2),
        };
    }
    protected static convertOpenApiSchemasToCommonTypes(
        schemasObject: { [key: string]: OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject; },
    ): Record<string, CommonType<string>> {
        const commonTypes: Record<string, CommonType<string>> = {};
        for (const schemaName in schemasObject) {
            const openApiSingleSchema = schemasObject[schemaName];
            if (typeof openApiSingleSchema !== 'object' || openApiSingleSchema === null) {
                console.warn(`WARNING!! Invalid schema OpenAPI ${schemaName} - skipping`);
                continue;
            }
            commonTypes[schemaName] = Tools.convertSingleOAISchemaToCommonType(schemaName, openApiSingleSchema);
        }
        return commonTypes;
    }

    protected static convertSingleOAISchemaToCommonType(schemaName: string, openApiSingleSchema: OpenAPIV3.ReferenceObject | OpenAPIV3.SchemaObject): Type<string> {
        if ('$ref' in openApiSingleSchema) {
            const refValue = openApiSingleSchema['$ref'];
            if (typeof refValue !== 'string' || !refValue.startsWith('#/components/schemas/')) {
                throw new Error(`Unsupported $ref value for ${schemaName}. Only local refs to #/components/schemas/MyType are supported`);
            }
            const refTypeName = refValue.split('/').slice(-1)[0];
            return { type: refTypeName };
        } else if ('type' in openApiSingleSchema && typeof openApiSingleSchema.type === 'string') {
            switch (openApiSingleSchema.type) {
                case 'object': {
                    const attributes: Record<string, Type<string>> = {};
                    if (!openApiSingleSchema.properties) {
                        return {
                            type: 'Record',
                            attributes,
                        };
                    }
                    for (const propertyName in openApiSingleSchema.properties) {
                        const property = openApiSingleSchema.properties[propertyName];
                        attributes[propertyName] = Tools.convertSingleOAISchemaToCommonType(propertyName, property);
                    }
                    return {
                        type: 'Record',
                        attributes,
                    };
                }
                case 'array': {
                    if (!openApiSingleSchema.items ) {
                        throw new Error(`Unsupported schema for ${schemaName} - could not determine the type of the array item`);
                    }
                    return {
                        type: 'Set',
                        element: Tools.convertSingleOAISchemaToCommonType(schemaName, openApiSingleSchema.items)
                    };
                }
                default: {
                    const cedarTypeDef = Object.assign(
                        {},
                        Tools.openAPIToCedarPrimitiveTypeMap[openApiSingleSchema.type],
                    );
                    if (!cedarTypeDef) {
                        throw new Error(`Unsupported schema for ${schemaName} - type ${openApiSingleSchema.type} is not supported`);
                    }
                    return cedarTypeDef;
                }
            }
        } else {
            throw new Error(`Unsupported shape of ${schemaName}, it neither has a type nor a $ref.`);
        }
    }

    protected static generateActionDefinitionFromOperationObject(
        httpVerb: string,
        httpPathTemplate: string,
        operationObject: OpenAPIV3.OperationObject<CedarOpenAPIExtension>
    ): {actionName: string, actionDefinition: ActionType<string>} {
        const actionName: string = get(operationObject, 'operationId', `${httpVerb} ${httpPathTemplate}`);
        let resourceTypes: string[] = ['Application'];
        const cedarExtension = operationObject?.['x-cedar'];
        if (!!cedarExtension && typeof cedarExtension === 'object') {
            const isValidValue = 'appliesToResourceTypes' in cedarExtension &&
                Array.isArray(cedarExtension.appliesToResourceTypes) &&
                cedarExtension.appliesToResourceTypes.every((value) => typeof value === 'string');
            if (isValidValue) {
                resourceTypes = cedarExtension.appliesToResourceTypes;
            } else {
                throw new Error(`Invalid x-cedar extension in operation definition for ${httpVerb} ${httpPathTemplate}`);
            }
        }
        let attributes = {};
        if (Array.isArray(operationObject.parameters)) {
            attributes = Tools._convertOpenApiParametersToContextdefinition(operationObject.parameters);
        }
        const actionDefinition: ActionType<string> = {
            appliesTo: {
                context: { type: 'Record', attributes },
                principalTypes: ['User'],
                resourceTypes,
            },
        }
        return {
            actionName,
            actionDefinition,
        };
    }
    static _convertOpenApiParametersToContextdefinition(parameters: (OpenAPIV3.ReferenceObject | OpenAPIV3.ParameterObject)[]): {pathParameters: TypeOfAttribute<string>, queryStringParameters: TypeOfAttribute<string>} {
        const result = {
            pathParameters: {
                type: 'Record',
                attributes: {},
            },
            queryStringParameters: {
                type: 'Record',
                attributes: {},
            },
        };
        for (const paramDefn of parameters) {
            if ('$ref' in paramDefn) {
                throw new Error('OpenAPI parameters directly defined as $ref\'s are not supported');
            }
            if (!paramDefn.name || !paramDefn.in || !paramDefn.schema) {
                throw new Error('OpenAPI operation parameters must have a "name", "schema", and "in" properties.');
            }
            if (!['path', 'query'].includes(paramDefn.in)) {
                console.warn(`Found unsupported parameter of type ${paramDefn.in}, skipping...`);
                continue;
            }
            const cedarSchemaParamToMerge: Record<string, TypeOfAttribute<string>> = {
                [paramDefn.name]: Tools.convertSingleOAISchemaToCommonType(paramDefn.name, paramDefn.schema),
            };
            if (paramDefn.required) {
                Object.assign(cedarSchemaParamToMerge[paramDefn.name], { required: true });
            }
            const typeOfParam = paramDefn.in === 'path' ? 'pathParameters': 'queryStringParameters';
            Object.assign(result[typeOfParam].attributes, cedarSchemaParamToMerge);
        }
        return result;
    }

    protected static buildAdditionalResourceTypesMap(
        openApiSpec: OpenAPIV3.Document,
        resourcesThatNeedToBeAddedToSchema: Set<string>
    ): Record<string, EntityType<string>> {
        const ret: Record<string, EntityType<string>> = {};

        const emptyRecordShape = {
            type: 'Record',
            attributes: {},
        };
        const openApiSchemas = openApiSpec.components?.schemas || {};
        for (const resourceTypeName of resourcesThatNeedToBeAddedToSchema) {
            const shape = !!openApiSchemas[resourceTypeName] ? { type: resourceTypeName } : emptyRecordShape;
            
            ret[resourceTypeName] = {
                shape,
                memberOfTypes: [],
            };
        }
        return ret;
    }

    /**
     * This function validates that the passed in schema string is a valid schema, then returns back the stringified schema in json.
     * @param cedar cedar library
     * @param stringifiedSchema stringified schema
     * @returns a Record, but based on the 
     */
    public static validateSchemaJson(cedar: typeof import('@cedar-policy/cedar-wasm/nodejs'), stringifiedSchema: StringifiedSchema): string {
        switch(stringifiedSchema.type) {
            case 'jsonString': {
                const parsedSchema = JSON.parse(stringifiedSchema.schema);
                const parseResult = cedar.checkParseSchema(parsedSchema);
                if (parseResult.type === 'failure') {
                    const errors = parseResult.errors.map(({message}) => message).join('\n');
                    throw new Error(`Schema parsing failed: ${errors}`);
                }
                return stringifiedSchema.schema;
            }
            case 'cedarFormat': {
                const parseResult = cedar.checkParseSchema(stringifiedSchema.schema);
                if (parseResult.type === 'failure') {
                    const errors = parseResult.errors.map(({message}) => message).join('\n');
                    throw new Error(`Schema parsing failed: ${errors}`);
                }
                const convertedSchemaToJson = cedar.schemaToJson(stringifiedSchema.schema);
                if (convertedSchemaToJson.type === 'failure') {
                    const errors = convertedSchemaToJson.errors.map(({message}) => message).join('\n');
                    throw new Error(`Schema conversion failed: ${errors}`);
                }
                return JSON.stringify(convertedSchemaToJson.json);
            }
            default: {
                throw new Error(`Unexpected schema type. Only 'jsonString' and 'cedarFormat' are valid.`);
            }
        
        }
    }

    public static generatePoliciesForSchema(cedar: typeof import('@cedar-policy/cedar-wasm/nodejs'), schema: StringifiedSchema): string[] {
        let schemaJson = JSON.parse(Tools.validateSchemaJson(cedar, schema)) as SchemaJson<string>;
        const namespaces = Object.keys(schemaJson);
        if (namespaces.length !== 1) {
            throw new Error('Schema must have exactly one namespace');
        }
        const namespace = namespaces[0];
        const actions = Object.keys(schemaJson[namespace].actions);
        const policies = [
            `// Allows admin usergroup access to everything
            permit(
                principal in ${namespace}::UserGroup::"admin",
                action,
                resource
            );`,
            `// Allows more granular user group control, change actions as needed
            permit(
                principal in ${namespace}::UserGroup::"ENTER_THE_USER_GROUP_HERE",
                action in [
                    ${actions.map(a => `${namespace}::Action::"${a}"`).join(',\n        ')}
                ],
                resource
            );`
        ];
        // let's check that the policies parse
        for (let idx = 0; idx < policies.length; idx++) {
            const policyStr = policies[idx];
            const parseResult = cedar.checkParsePolicySet({
                staticPolicies: policyStr,
            });
            if (parseResult.type === 'failure') {
                const errors = parseResult.errors.map(({message}) => message).join('\n');
                throw new Error(`Policy parsing failed for policy ${idx}: ${errors}`);
            }
        }
        // let's check that the policies validate
        for (let idx = 0; idx < policies.length; idx++) {
            const policyStr = policies[idx];
            const validateResult = cedar.validate({
                validationSettings: {
                    mode: 'strict',
                },
                schema: schemaJson,
                policies: {
                    staticPolicies: policyStr,
                },
            });
            if (validateResult.type === 'failure') {
                const errors = validateResult.errors.map(({message}) => message).join('\n');
                throw new Error(`Policy validation failed for policy ${idx}: ${errors}`);
            }
    
        }
        //lets try to format the policies
        return policies.map(policyText => {
            const formatResult = cedar.formatPolicies({
                policyText,
                indentWidth: 4,
            });
            if (formatResult.type === 'success') {
                return formatResult.formatted_policy;
            }
            return policyText;
        });
    }
}

