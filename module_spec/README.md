# module_spec

Modulo interno do SpecFlow para catalogo de equipamentos e filtro simples de selecao por perfil.

## Objetivo

Implementar selecao de variacoes de equipamentos por comparacao direta entre:

- valores resolvidos do formulario (SpecFlow principal)
- atributos cadastrados na variacao do equipamento
- mappings configurados por perfil

Sem engine complexa, sem score, sem ranking avancado, sem IA.

## Estrutura

- `migrate.js`: migration isolada do modulo em banco dedicado
- `src/routes/index.js`: API interna REST do modulo
- `src/controllers/createModuleSpecController.js`: controladores HTTP
- `src/repositories/simpleRepository.js`: queries SQL do modulo
- `src/services/simpleFilterService.js`: validacao de mappings e filtro direto
- `src/services/specIntegrationService.js`: leitura do formulario/equipment do sistema principal

## Tabelas

- `equipment_families`
- `equipment_models` (reaproveitada, com `family_id` e `description`)
- `equipment_variants`
- `equipment_attribute_definitions`
- `equipment_variant_attributes`
- `profile_filter_mappings`

## Endpoints REST internos

### Familias
- `GET /api/module-spec/families`
- `POST /api/module-spec/families`
- `GET /api/module-spec/families/:id`
- `PUT /api/module-spec/families/:id`
- `DELETE /api/module-spec/families/:id`

### Modelos
- `GET /api/module-spec/models`
- `POST /api/module-spec/models`
- `GET /api/module-spec/models/:id`
- `PUT /api/module-spec/models/:id`
- `DELETE /api/module-spec/models/:id`

### Variacoes
- `GET /api/module-spec/models/:id/variants`
- `POST /api/module-spec/models/:id/variants`
- `GET /api/module-spec/variants/:id`
- `PUT /api/module-spec/variants/:id`
- `DELETE /api/module-spec/variants/:id`

### Definicao de atributos
- `GET /api/module-spec/attributes/definitions`
- `POST /api/module-spec/attributes/definitions`
- `GET /api/module-spec/attributes/definitions/:id`
- `PUT /api/module-spec/attributes/definitions/:id`
- `DELETE /api/module-spec/attributes/definitions/:id`

### Atributos da variacao
- `GET /api/module-spec/variants/:id/attributes`
- `PUT /api/module-spec/variants/:id/attributes`

### Mapping de filtro por perfil
- `GET /api/module-spec/profiles/:profileId/filter-mappings`
- `PUT /api/module-spec/profiles/:profileId/filter-mappings`

### Execucao de filtro
- `POST /api/module-spec/profiles/:profileId/filter`
- `POST /api/module-spec/equipments/:equipmentId/filter`

## Operadores suportados

- `equals`
- `contains`
- `gte`
- `lte`

## Fluxo

1. Cadastra familia -> modelo -> variacoes.
2. Cadastra atributos da variacao.
3. Configura mappings no perfil (`field_id` -> `equipment_attribute_key`).
4. Executa filtro com:
  - `profileId` + `required` resolvido, ou
  - `equipmentId` (o modulo resolve do SpecFlow principal).
5. Retorno:
  - `matches`
  - `appliedFilters`
  - `ignoredFilters`
  - `totalMatches`

## Exemplo de mapping (PUT /profiles/:profileId/filter-mappings)

```json
[
  {
    "fieldId": 10,
    "equipmentAttributeKey": "power_kva",
    "operator": "equals",
    "filterActive": true,
    "requiredMatch": true,
    "sortOrder": 1
  },
  {
    "fieldId": 15,
    "equipmentAttributeKey": "output_voltage",
    "operator": "equals",
    "filterActive": true,
    "requiredMatch": true,
    "sortOrder": 2
  }
]
```

Arquivo pronto: `module_spec/examples/mapping-example.json`

## Exemplo de filtro (POST /profiles/:profileId/filter)

```json
{
  "required": {
    "power_kva": 100,
    "output_voltage": 380
  }
}
```

Arquivo pronto: `module_spec/examples/filter-request-example.json`

## UI admin integrada

A tela do modulo fica em `/admin/module-spec` usando o mesmo layout do painel atual.

No gerenciamento de perfis (`/admin/profiles`) existe botao contextual **Filtro de Selecao** em cada perfil, apontando para `/admin/module-spec?profile_id=<id>`.

## Seguranca

- Reusa sessao admin e `requireApiScope` do SpecFlow.
- Sem execucao dinamica de codigo.
- Payloads validados no backend.

## Testes

```bash
npm run test:module-spec
```
