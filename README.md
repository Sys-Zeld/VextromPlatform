# Vextrom Platform

Guia tecnico para desenvolvimento e operacao da plataforma.

## Visao geral

Aplicacao Node.js (Express + EJS + PostgreSQL) com arquitetura modular:

- `specflow`: formulario tecnico dinamico
- `report_service`: OS, relatorio tecnico, assinatura e analytics
- `module_spec`: catalogo/filtro de equipamentos
- `configdb`: usuarios admin e configuracoes de aparencia por usuario

## Arquitetura de runtime

Entrada de processo:

- `src/app.js` -> inicia `specflow/app.js`

Composicao da aplicacao:

- `specflow/app.js` monta middlewares globais (helmet, csrf, auth, i18n, tema)
- `report_service/src/app.js` registra:
  - `/api/report-service`
  - `/admin/report-service`
  - `/service-report`
  - `/r` (rotas publicas de assinatura)
- `module_spec/src/app.js` e carregado conforme flag de modulo

Pastas principais:

- `specflow/`: app base, hub e admin
- `report_service/`: dominio de OS/relatorio
- `module_spec/`: modulo de filtro
- `configdb/`: migracao de banco de administracao
- `scripts/`: automacoes de migrate/seed/backup/restore

## Bancos de dados e isolamento

Cada modulo possui banco dedicado:

- `dbspeflow` (SpecFlow)
- `reportservice` (Report Service)
- `dbmodulespec` (Module Spec)
- `configdb` (usuarios/admin UI)

Resolucao de conexao:

- `specflow/config/env.js` monta `env.databases.*`
- migrate global em `specflow/db/migrate.js` executa:
  - migrate SpecFlow
  - migrate ConfigDB
  - migrate Report Service
  - migrate Module Spec (quando habilitado)

## Rotas tecnicas

### Report Service (Web Admin)

Base: `/admin/report-service`

Principais grupos:

- OS: `/orders*`
- Editor de relatorio: `/orders/:id/report-editor`
- Preview/PDF:
  - `/orders/:id/preview-html`
  - `/orders/:id/preview-html/template/:templateKey`
  - `/orders/:id/generate-pdf`
- Assinatura tecnica: `/orders/:id/sign-report`
- Analytics:
  - `/analytics`
  - `/analytics/data`
  - `/analytics/export-pdf`

### Report Service (Publico)

Base: `/r`

- `GET /r/sign/:token`
- `POST /r/sign/:token`
- `POST /r/sign/:token/refuse`
- `GET /r/sign/:token/report`
- `GET /r/signed/:token`

### Report Service (API)

Base: `/api/report-service`

- escopos: `report-service:read`, `report-service:write`
- recursos: orders, customers, sites, equipments, timesheet, reports, sections, components, signatures, pdf

## Fluxos de negocio implementados (Report Service)

- criacao/edicao de OS
- validacao de OS restrita a perfil admin
- revalidacao de OS restrita a perfil admin
- controle de revisao de relatorio (A, B, C...)
- assinatura tecnica interna
- assinatura de cliente por token publico
- envio de emails por templates HTML
- traducao automatica PT/EN/ES com IA
- dashboard gerencial com exportacao PDF

## Tags de renderizacao do relatorio

Suportadas no rich text:

- `@img=ID`
- `@equip=ID`
- `@descricaodia=ID`
- `@descricaodia`
- `@conclusaogeral`
- `@tblcmpr`
- `@tblcmpq`
- `@tblcmps`
- `@tblequip` (tabela por equipamento, titulo = TAG)
- `@timesheet`
- `@equipetecnica`

Implementacao de preview:

- parser e injecao em `report_service/src/services/reportPreviewService.js`
- estilos de saida em `specflow/public/css/report-preview.css`

## Setup de desenvolvimento

### Requisitos

- Node.js 18+
- PostgreSQL 14+

### Bootstrap local

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed:default
npm run dev
```

App local: `http://localhost:3000`

## Comandos de engenharia

### Execucao

- `npm run dev`
- `npm run start`

### Toggle de modulos

- `npm run modules:enable:all`
- `npm run modules:disable:all`
- `npm run specflow:enable` / `npm run specflow:disable`
- `npm run report-service:enable` / `npm run report-service:disable`
- `npm run module-spec:enable` / `npm run module-spec:disable`

### Migracoes

- `npm run db:migrate`
- `npm run db:migrate:specflow`
- `npm run db:migrate:report-service`
- `npm run db:migrate:config`
- `npm run db:migrate:module-spec`

### Seed

- `npm run db:seed`
- `npm run db:seed:default`
- `npm run db:seed:specflow`
- `npm run db:seed:report-service`
- `npm run db:seed:module-spec`

### Backup/Restore

- `npm run db:backup:specflow`
- `npm run db:backup:report-service`
- `npm run db:backup:config`
- `npm run db:backup:module-spec`
- `npm run db:backup:all`
- `npm run db:restore:specflow`
- `npm run db:restore:report-service`
- `npm run db:restore:config`
- `npm run db:restore:module-spec`
- `npm run db:restore-database`
- `npm run assets:backup`
- `npm run assets:clean`
- `npm run assets:restore`

Validacao de seguranca no restore:

- o restore valida o modulo por prefixo do arquivo **e** assinaturas de tabelas dentro do `.sql`
- se houver conflito (ex: arquivo `specflow-*` com tabelas `service_report_*`), o restore e bloqueado
- backups mistos (mais de um modulo no mesmo dump) sao bloqueados para evitar restore no banco errado
- ajuste opcional de leitura para validacao: `DB_RESTORE_SCAN_BYTES` (padrao `8388608`)

### Manutencao de dados (Report Service)

- `npm run report-service:spare-parts:clear` — apaga todos os spare parts e vinculos com equipamentos (pede confirmacao digitando `CONFIRMAR`)
- `npm run report-service:os:init` — seed inicial de OS

### Operacao admin

- `npm run admin:sessions:clear`
- `npm run admin:public-limit:reset`
- `npm run api:key:create`
- `npm run api:key:list`
- `npm run api:key:revoke -- <id>`
- `npm run api:key:delete -- <id>`

## Configuracoes de ambiente (chaves criticas)

### Core

- `PORT`
- `APP_BASE_URL`
- `SPECFLOW_ENABLED`
- `REPORT_SERVICE_ENABLED`
- `MODULE_SPEC_ENABLED`

### Databases

- `SPECFLOW_DATABASE_URL`
- `REPORT_SERVICE_DATABASE_URL`
- `CONFIG_DATABASE_URL`
- `MODULE_SPEC_DATABASE_URL`

### Admin/Auth

- `ADMIN_USER`
- `ADMIN_PASS`
- `ADMIN_SESSION_SECRET`
- `ADMIN_SESSION_TTL_HOURS`

### SMTP

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

### IA (traducao/revisao)

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (padrao `gpt-4.1-mini`)
- `OPENAI_BASE_URL`
- `OPENAI_MAX_OUTPUT_TOKENS`
- `OPENAI_MAX_OUTPUT_RETRIES`
- `OPENAI_MAX_OUTPUT_TOKENS_CAP`

### Storage

- `DOCS_DIR`

## UI, temas e preferencias

- temas: `soft`, `vextrom`, `xvextrom`
- tokens visuais centralizados em `specflow/public/css/app.css`
- tema salvo no browser em `localStorage` (`app_theme`)
- fonte por usuario salva em `configdb` (`admin_users.ui_font`)

## Painel de manutencao

- `/admin/maintenance/system`
- `/admin/maintenance/specflow`
- `/admin/maintenance/report-service`
- `/admin/maintenance/module-spec`

Recursos:

- SMTP
- templates de email
- destinatarios padrao
- backup/restore
- gestao de usuarios admin
- tipografia por usuario

## Troubleshooting tecnico

### `Cannot GET /r/signed/<token>`

- validar `REPORT_SERVICE_ENABLED=true`
- validar montagem de rota publica `/r` em `report_service/src/app.js`
- validar existencia/estado do token no banco do report service

### `Cannot find module 'puppeteer'`

- executar `npm install`
- validar dependencia `puppeteer` em `package.json`
- reiniciar processo da aplicacao

### PDF divergente do preview

- comparar `/orders/:id/preview-html/template/:templateKey` com PDF gerado
- validar carregamento de `specflow/public/css/report-preview.css`
- validar template EJS selecionado em `report_service/templates/report/*`

## Licenca

MIT
