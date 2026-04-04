# APP-FORM-UPS-IEC

Projeto full-stack em Node.js (Express + EJS + PostgreSQL) para especificacao de UPS baseada no IEC 62040-3 (Anexo D), com:

- Campos dinamicos por secao
- Campos habilitados por cliente/token
- Perfis salvos de campos para reutilizacao
- CRUD de campos (`text`, `number`, `enum`, `boolean`, `time`, `dimension`)
- `hasDefault` + `defaultValue` por campo
- Precedencia de valor no formulario: `salvo > default > vazio`
- APIs de fields e specification

## Estrutura Atual

- `src/app.js`: ponto de entrada (starter) da aplicacao na raiz.
- `specflow/app.js`: logica principal do modulo SpecFlow (rotas, middlewares e bootstrap do modulo).
- `specflow/config`, `specflow/db`, `specflow/services`, `specflow/views`, `specflow/public`: camadas compartilhadas usadas pelo SpecFlow.
- `module_spec/`: modulo isolado de catalogo/filtro.
- `report_service/`: modulo isolado de relatorios de servico.

## Requisitos

- Node.js 18+
- PostgreSQL 14+

## Execucao

```bash
npm install
npm run db:migrate
npm run db:seed:default
npm run dev
```

Aplicacao: `http://localhost:3000`

## Bootstrap

- O `npm run start` e `npm run dev` executam `src/app.js`.
- `src/app.js` inicializa e sobe o servidor via `specflow/app.js`.

## Comandos de manutencao APP via NPM

- `npm run dev`: sobe a aplicacao em modo desenvolvimento (`nodemon`).
- `npm run start`: sobe a aplicacao em modo normal.
- `npm run modules:enable:all`: habilita todos os modulos (`specflow`, `module-spec`, `report-service`).
- `npm run modules:disable:all`: desabilita todos os modulos.
- `npm run specflow:enable` / `npm run specflow:disable`: habilita/desabilita o modulo SpecFlow.
- `npm run module-spec:enable` / `npm run module-spec:disable`: habilita/desabilita o modulo Module Spec.
- `npm run report-service:enable` / `npm run report-service:disable`: habilita/desabilita o modulo Report Service.
- `npm run db:migrate`: aplica as migracoes do banco.
- `npm run db:migrate:config`: aplica migracao dedicada do banco `configdb` (administracao de usuarios).
- `npm run db:backup-database`: alias de `npm run db:backup:specflow` (backup isolado do banco `dbspeflow`).
- `npm run db:backup:specflow`: backup apenas do banco `dbspeflow`.
- `npm run db:backup:config`: backup apenas do banco `configdb`.
- `npm run db:backup:module-spec`: backup apenas do banco `dbmodulespec`.
- `npm run db:backup:report-service`: backup apenas do banco `reportservice`.
- `npm run db:backup:all`: backup dos 4 bancos isolados.
- `npm run db:restore-database`: restaura o backup mais recente de `dados/backups` (limpa o schema `public` antes por padrao).
- `npm run db:restore:specflow`: restaura backup do banco `dbspeflow`.
- `npm run db:restore:config`: restaura backup do banco `configdb`.
- `npm run db:restore:module-spec`: restaura backup do banco `dbmodulespec`.
- `npm run db:restore:report-service`: restaura backup do banco `reportservice`.
- `npm run db:seed`: executa seed dos modulos (specflow + report_service + module_spec quando habilitado).
- `npm run db:seed:specflow`: aplica seed do SpecFlow (campos Anexo D).
- `npm run db:seed:module-spec`: executa seed do Module Spec.
- `npm run db:seed:report-service`: executa seed do Report Service.
- `npm run db:seed:default`: aplica `db:seed` + `node scripts/seed-profile-purchase.js`.
- `npm run db:reset`: limpa tabelas principais e reinicia IDs.
- `npm run db:reset-schema`: remove e recria o schema `public` (limpeza estrutural total para restore).
- `npm run db:restore-clean`: executa `db:reset-schema` + `db:restore-database`.
- `npm run db:reseed`: executa `db:reset` + `db:seed`.
- `npm run api:key:create -- --name "integracao-x" --scopes "fields:read,spec:read,spec:write"`: cria API key.
- `npm run api:key:list`: lista API keys cadastradas.
- `npm run api:key:revoke -- 1`: revoga API key por ID.
- `npm run api:key:delete -- 1`: deleta API key por ID.
- `npm run admin:sessions:clear`: invalida todas as sessoes admin ativas.
- `npm run admin:public-limit:reset`: reseta o contador de limite do modulo publico (IP/sessao navegador).
- `npm run token:set-sent -- --token=<TOKEN>`: forca status do token para `send` (uso de teste).
- `npm run token:set-draft -- --token=<TOKEN>`: forca status do token para `draft` (uso de teste).
- `npm run stress:specflow`: stress de clientes no SpecFlow.
- `npm run stress:specflow:profile`: stress de perfis de formulario do SpecFlow.
- `npm run stress:module-spec`: stress do modulo Module Spec.
- `npm run stress:report-service`: stress do modulo Report Service.
- `npm run teste-cliente`: alias legado para `npm run stress:specflow`.
- `npm run teste-perfil-form`: alias legado para `npm run stress:specflow:profile`.

### Painel de manutencao admin

- Acesse `/admin/maintenance/system` para manutencao global do sistema (backup de todos os bancos, migrate/seed e links dos modulos).
- Em `/admin/maintenance/system`, na secao **Backup e restore (SpecFlow)**, ficou apenas a opcao de **importar banco** (`.sql`).
- Acesse `/admin/maintenance/specflow` (ou `/admin/maintenance`) para manutencao do SpecFlow (backup banco, reset/seed, links publicos, SMTP, templates e destinatarios padrao).
- Acesse `/admin/maintenance/module-spec` para manutencao do Module Spec (backup do banco dedicado).
- Acesse `/admin/maintenance/report-service` para manutencao do Report Service (backup, SMTP e templates dedicados).
- Perfil `admin`: acesso completo a comandos, backup/restore, cards de modulos e gestao de usuarios.
- Perfil `user`: acesso limitado em `/admin/maintenance/system` para:
  - alterar a propria senha
  - alterar a tipografia do proprio perfil
- O cadastro e a gestao de usuarios adicionais ficam em `/admin/maintenance/system` (somente `admin`).

## Exemplos CMD - stress por modulo

```cmd
npm run stress:specflow -- --count=500 --concurrency=20
```

```cmd
npm run stress:specflow:profile -- --count=200 --concurrency=10 --with-field
```

```cmd
npm run stress:module-spec -- --count=300 --concurrency=15
```

```cmd
npm run stress:report-service -- --count=300 --concurrency=15
```

## Backup e restore do banco

- Backup isolado por modulo:
  - `npm run db:backup:specflow`
  - `npm run db:backup:config`
  - `npm run db:backup:module-spec`
  - `npm run db:backup:report-service`
- Backup de todos os modulos:
  - `npm run db:backup:all`
- Alias legado (SpecFlow):
  - `npm run db:backup-database`
- Restore do ultimo backup (mais recente, com limpeza automatica do schema `public`):
  - `npm run db:restore-database`
- Restore isolado por modulo:
  - `npm run db:restore:specflow -- "dados/backups/specflow-backup-YYYY-MM-DDTHH-MM-SS-sssZ.sql"`
  - `npm run db:restore:config -- "dados/backups/config-backup-YYYY-MM-DDTHH-MM-SS-sssZ.sql"`
  - `npm run db:restore:module-spec -- "dados/backups/module-spec-backup-YYYY-MM-DDTHH-MM-SS-sssZ.sql"`
  - `npm run db:restore:report-service -- "dados/backups/report-service-backup-YYYY-MM-DDTHH-MM-SS-sssZ.sql"`
- Restore de arquivo especifico:
  - `npm run db:restore-database -- "dados/backups/db-backup-2026-03-07T03-43-17-589Z.sql"`
- Importacao de arquivo `.sql` pela UI:
  - Acesse `/admin/maintenance`
  - Use o bloco **Importar arquivo .sql**
  - O upload apenas importa o arquivo para `dados/backups` e atualiza o catalogo
  - Depois execute o restore pelo botao **Restaurar** na lista de backups
  - Limite atual: `50 MB`
- Restore sem limpar schema antes (avancado):
  - `npm run db:restore-database -- --no-clean`
- Restore limpo (remove schema e depois restaura):
  - `npm run db:restore-clean`
- Timeout do restore:
  - Variavel opcional `DB_RESTORE_TIMEOUT_MS` (padrao: `1200000`, 20 minutos)

## Modelo de dados novo

- `fields`: cadastro dinamico de campos (com secao, tipo, enum e default opcional)
- `equipments`: registro do equipamento/token
- `field_profiles` + `field_profile_fields`: perfis reutilizaveis com conjuntos de campos
- `equipment_enabled_fields`: campos habilitados por equipamento/token
- `equipment_field_values`: valores por equipamento e campo
- `equipment_documents`: anexos PDF por equipamento/token

## Fluxo de cliente com perfil

1. Acesse `/admin/clients/new`.
2. Informe nome e contato.
3. Escolha um perfil salvo (opcional) para preencher os campos habilitados.
4. Ajuste manualmente os checkboxes se necessario.
5. Opcionalmente informe um nome em "Salvar selecao atual como novo perfil".
6. Gere o token; o formulario desse cliente exibira somente os campos habilitados.

## Gestao de perfis de formulario

- Acesse `/admin/profiles` para criar, editar e excluir perfis de anexo formulario.
- Acesse `/admin/tokens/:id/config` para ajustar campos especificos de um cliente ja criado.
- Um perfil pode ser aplicado por cliente e os campos habilitados podem ser personalizados por cliente.
- Na tela de perfis, use o botao **Perfil com IA** para abrir a pagina dedicada `/admin/profiles/ai`.
- Na pagina dedicada de IA, voce pode:
  - Enviar documento `PDF`, `TXT` ou `Excel` (`.xlsx`/`.xls`)
  - Informar um modelo JSON de perfil
  - Informar instrucoes adicionais para a IA (opcional)
  - Visualizar o prompt final enviado para a IA
  - Gerar JSON com IA (OpenAI), baixar o arquivo ou importar direto para criar um novo perfil
  - Limite de tamanho do documento para IA: `10MB`
  - Em falha de parse JSON, a resposta da IA e exibida com bloco `debug` (payload bruto) para diagnostico

### Variaveis de ambiente para IA (OpenAI)

- `OPENAI_API_KEY`: chave da API OpenAI (obrigatoria para o recurso de IA).
- `OPENAI_MODEL`: modelo usado na geracao (padrao: `gpt-4.1-mini`).
- `OPENAI_BASE_URL`: base da API (padrao: `https://api.openai.com/v1`).
- `OPENAI_MAX_OUTPUT_TOKENS`: tokens de saida por tentativa (padrao: `8000`).
- `OPENAI_MAX_OUTPUT_RETRIES`: tentativas adicionais em caso de truncamento por tokens (padrao: `2`).
- `OPENAI_MAX_OUTPUT_TOKENS_CAP`: limite maximo de tokens por tentativa com escalonamento (padrao: `20000`).

## Anexos PDF

- No final do formulario de especificacao, e possivel anexar PDFs (ex.: desenho unifilar e trifilar).
- Limite: ate 10 documentos por token, com ate 10MB por arquivo.
- Apenas PDF e aceito.
- Os arquivos sao salvos em `dados/docs` (na raiz da aplicacao).
- O sistema salva no banco o link externo do arquivo, baseado em `APP_BASE_URL`.
- Em producao, use `APP_BASE_URL` sem porta interna (ex.: `https://form.seudominio.com`).

## Temas visuais do formulario

- O projeto possui tres temas: `Soft`, `Vextrom` (padrao) e `XVextrom`.
- A troca e feita no seletor `Tema` no topo da tela.
- A preferencia fica salva em `localStorage` na chave `app_theme` (`soft`, `vextrom` ou `xvextrom`).
- Os tokens visuais (cores, sombras, bordas, espacamentos) ficam centralizados em `specflow/public/css/app.css`:
  - bloco `:root, :root[data-theme="soft"]`
  - bloco `:root[data-theme="vextrom"]`
  - bloco `:root[data-theme="xvextrom"]`

## Tipografia por usuario

- A selecao de fonte e feita em `/admin/maintenance/system`, no card **Tipografia por usuario**.
- A preferencia de fonte e individual por conta e salva na tabela `admin_users` do banco `configdb` (coluna `ui_font`).
- Fontes disponiveis:
  - `Inter` (atual)
  - `Manrope`
  - `Nunito`
  - `Source Sans 3`
  - `IBM Plex Sans`

## Navegacao dos modulos (icones)

- Os botoes de navegacao de modulos usam o mesmo padrao de icones do Hub:
  - `/admin/hub` -> `build_circle`
  - `module-spec` -> `tune`
  - `report-service` (`orders/equipments/customers`) -> `monitoring`

## Seed do Anexo D

- O seed oficial esta em `specflow/schema/annexD.fields.seed.js`
- `npm run db:seed:specflow` popula/atualiza todos os campos do Anexo D
- o seed do SpecFlow tambem garante:
  - perfil padrao `PADRAO CHLORIDE`
  - cliente padrao `Cliente Padrao SpecFlow`
- `npm run db:seed:report-service` garante dados padrao do modulo:
  - cliente, site e equipamento padrao
  - ordem de servico padrao
  - relatorio padrao vinculado a ordem
- `npm run db:seed:default` tambÃƒÂ©m cria/atualiza o perfil padrÃƒÂ£o `PADRÃƒO CHLORIDE`
- O servidor tambem chama `seedAnnexDFields()` no startup para garantir estrutura base

## Como adicionar/editar campos

1. Acesse `/admin/fields`
2. Crie ou edite o campo informando:
   - `key` unica (slug)
   - `section`
   - `fieldType`
   - `enumOptions` (se `enum`)
   - toggle `Usar valor padrao` (`hasDefault=true`)
   - `defaultValue`
3. Salve. O campo aparece automaticamente no formulario de especificacao.

## Regra de default no formulario

No carregamento da especificacao:

1. Se existe valor salvo para `(equipmentId, fieldId)`, usa esse valor.
2. Senao, se `hasDefault=true`, usa `defaultValue` e marca badge `padrao`.
3. Senao, deixa vazio.

Ao salvar vazio, o valor salvo e removido e a regra volta para default/vazio.

## APIs principais

- `GET /fields?section=...`
- `POST /fields`
- `PUT /fields/:id`
- `DELETE /fields/:id`
- `GET /equipment/:id/specification`
- `PUT /equipment/:id/specification`

Autenticacao da API:

- Header: `Authorization: Bearer <API_KEY>` (ou `X-API-Key: <API_KEY>`).
- Escopos:
  - `fields:read`
  - `fields:write`
  - `spec:read`
  - `spec:write`
- Sessao admin valida tambem tem acesso (fallback para uso interno no painel).

## Documentacao da API

- Arquivo HTML da documentacao: `api.html`



