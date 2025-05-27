/**
 * Cedar mirror types
 */
export interface EntityUid {
    type: string;
    id: string;
}

export interface FnAndArg {
    fn: string;
    arg: CedarValueJson;
}

type CedarValueJson = { __entity: EntityUid } | { __extn: FnAndArg } | boolean | number | string | CedarValueJson[] | { [key: string]: CedarValueJson } | null;

export interface Entity {
    uid: EntityUid;
    attrs: Record<string, CedarValueJson>; // backup plan: Record<string, any>
    parents: EntityUid[]
}

export interface AuthorizationRequest {
    principal: EntityUid;
    action: EntityUid;
    resource: EntityUid;
    context: Record<string, CedarValueJson>;
}

/**
 * Authorizer interface (transpiled to other languages in JSII)
 */
export interface AuthorizationEngine {
    isAuthorized(
        request: AuthorizationRequest, entities: Entity[]
    ): Promise<AuthorizationResult>
}
export interface AuthorizationResultInformation {
    principalUid: EntityUid;
    determiningPolicies: string[];
}
 
export type AuthorizationResult =
    {type: 'deny'} |
    {type: 'allow', authorizerInfo: AuthorizationResultInformation} |
    {type: 'error', message: string};

/** 
 * Schema
*/
export type StringifiedSchema = {type: 'jsonString', schema: string } | {type: 'cedarFormat', schema: string};




/**
 * Common middleware elements
 */

export type ApiHttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
export const SUPPORTED_HTTP_METHODS: ApiHttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * OpenAPI helpers
 */
export interface CedarOpenAPIExtension {
    'x-cedar'?: {
        // This extension property is used when the extension is applied to operation objects.
        // The action corresponding to this openAPI operation will apply to these
        // resource types
        appliesToResourceTypes: string[];
    }
}

/**
 * export other files
 */
export * from './cedarInlineAuthorizationEngine';
export * from './tools';

export function assertUnreachable(_value: never): never {
    throw new Error('Statement should be unreachable');
}