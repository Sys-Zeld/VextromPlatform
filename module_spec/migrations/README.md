As migrations do modulo agora sao isoladas no proprio modulo em `module_spec/migrate.js`.

Execucao direta:

```bash
npm run db:migrate:module-spec
```

Ou pela migration principal do projeto:

```bash
npm run db:migrate
```

No inicio da migration, o banco `dbmodulespec` (ou o definido em `MODULE_SPEC_DATABASE_URL`) e criado automaticamente no PostgreSQL, quando nao existir.

Modelo atual simplificado:
- familias
- modelos
- variacoes
- definicao de atributos
- atributos por variacao
- mappings de filtro por perfil
