## Cedar-Authorization

A JavaScript/TypeScript library for authorization with the Cedar policy language. This package provides tools to integrate Cedar authorization into your applications, generate schemas from OpenAPI specifications, and manage authorization policies.

### Installation

```
npm i --save @cedar-policy/cedar-authorization
```
### Features

* Authorization Engine: Implement authorization checks using Cedar policies

* Schema Generation: Generate Cedar schemas from OpenAPI specifications

* Policy Generation: Create starter policies based on your schema

* CLI Tools: Command-line utilities for schema and policy generation

### Usage

#### Authorization Engine

This package provides an interface for an "Authorization Engine" which takes a Cedar request and entities, and returns an authorization result.

You may find example usages here: https://github.com/cedar-policy/cedar-authorization/blob/main/tests/cedarAuthorizer.test.ts

#### CLI Tools

**Schema Generation: Generate Cedar schemas from OpenAPI specifications**

```
npx @cedar-policy/cedar-authorization generate-schema \
  --api-spec path/to/openapi.json \
  --namespace YourNamespace \
  --mapping-type SimpleRest
```

This will generate two schema files:

v2.cedarschema.json - Compatible with Cedar 2.x and 3.x

v4.cedarschema.json - Compatible with Cedar 4.x and required by the nodejs Cedar plugins

When generating OpenApi specs, keep the following limitations in mind:

1. Version Support:
- Only OpenAPI v3 specifications are supported (uses OpenAPIV3 types from openapi-types)
- Earlier versions (like Swagger 2.0) are not supported

2. Namespace Requirements:
- Must have exactly one namespace
- Namespace must follow strict formatting rules:
  - Must start with a letter or underscore
  - Can only include alphanumeric characters and underscores
  - Components can be separated by double colons (::)
  - Each component must start with a letter or underscore
- Cannot use reserved words as namespaces ('if', 'in', 'is', '__cedar')

3. Schema Limitations:
- Only supports local schema references (must start with '#/components/schemas/') - can't link to a separate openApi file or url.

4. Parameter Restrictions for operations:
- Only supports 'path' and 'query' parameter types
- Other parameter types (like header, cookie) are skipped with a warning
- Parameters defined as direct $ref are not supported
- Parameters must have "name", "schema", and "in" properties

5. Server Configuration:
- If multiple servers are defined in the OpenAPI spec, a basePath parameter is required
- The provided basePath must match one of the server entries
- Server URLs must be valid URLs that can be parsed

6. Operation/Path Requirements:
- Only supports standard HTTP methods (defined in SUPPORTED_HTTP_METHODS)
- OPTIONS method is explicitly ignored
- Each operation must have valid operation objects
- x-cedar extensions, if present, must have valid appliesToResourceTypes

7. Resource Type Limitations:
- Default resource types (User, UserGroup, Application) are automatically included
- Custom resource types must be referenced in action definitions
- If a resource type is referenced but not defined in schemas, it gets an empty record shape

These limitations mean that complex OpenAPI specs with advanced features like non-standard extensions or sophisticated parameter types may not be fully supported by the tool.

**Policy Generation: Create starter policies based on your schema**

```
npx @cedar-policy/cedar-authorization generate-policies \
  --schema path/to/schema.json
```
This will create policy files in a policies directory with starter policies based on your schema.


CLI Tools: Command-line utilities for schema and policy generation

### API Reference

#### Core Types

```typescript
interface AuthorizationRequest {
  principal: EntityUid;
  action: EntityUid;
  resource: EntityUid;
  context: Record<string, CedarValueJson>;
}

interface Entity {
  uid: EntityUid;
  attrs: Record<string, CedarValueJson>;
  parents: EntityUid[];
}

type AuthorizationResult =
  { type: 'deny' } |
  { type: 'allow', authorizerInfo: AuthorizationResultInformation } |
  { type: 'error', message: string };
```

#### CedarInlineAuthorizationEngine

```typescript
class CedarInlineAuthorizationEngine implements AuthorizationEngine {
  constructor(config: CedarInlineAuthorizerConfiguration);
  isAuthorized(request: AuthorizationRequest, entities: Entity[]): Promise<AuthorizationResult>;
}
```


## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This project is licensed under the Apache-2.0 License.

## Publishing

Publishing to npm is done according to these links:

- https://docs.github.com/en/actions/use-cases-and-examples/publishing-packages/publishing-nodejs-packages  
- https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository#creating-a-release  