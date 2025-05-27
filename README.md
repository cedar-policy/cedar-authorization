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

[TODO: link to example]

#### CLI Tools

Authorization Engine: Implement authorization checks using Cedar policies

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

