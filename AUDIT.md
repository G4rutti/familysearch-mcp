# Auditoria — familysearch-mcp (fork combinado)

Data: 7 de novembro de 2026
Escopo: todo o código do repositório, ou seja, `src/*.ts`, `scripts/*.mjs`, `package.json` e `package-lock.json`, depois da junção dos forks do harrywesterman (branch `improvement`), twonky4 (branch `feature/family-records-research-suggestions`) e izzybps (`main`) por cima do original do JonathanReiss15.

## Resumo

O servidor é pequeno e não tem nada malicioso: nenhuma telemetria, nenhum envio pra terceiros, nenhum script de instalação próprio e nenhuma ferramenta que altere a árvore. Os problemas reais eram de **vazamento da sessão** e de **escrita em disco controlada pela IA**, e foram corrigidos. O risco que sobra não é de código: o projeto usa endpoints internos do site do FamilySearch com os teus cookies, fora da API oficial.

| # | Achado | Severidade | Status |
|---|---|---|---|
| 1 | Cookies podiam ir pra qualquer domínio vindo de uma resposta da API | Alta | Corrigido |
| 2 | Redirect podia levar os cookies pra fora do familysearch.org | Média | Corrigido |
| 3 | IDs entravam direto no caminho da URL, sem validação | Média | Corrigido |
| 4 | `download-document` gravava em qualquer pasta escolhida pela IA | Média | Corrigido |
| 5 | Dependências com 8 vulnerabilidades conhecidas (1 crítica, 5 altas) | Baixa (não alcançáveis) | Corrigido |
| 6 | `get-person` nunca mostrava cônjuges e filhos | Bug | Corrigido |
| 7 | `get-descendants` nunca retornava filhos e misturava irmãos | Bug | Corrigido |
| 8 | `set-session-cookie` faz os cookies passarem pela conversa com a IA | Baixa | Documentado |
| 9 | No Windows, o `config.json` com os cookies não tem permissão restrita | Baixa | Documentado |
| 10 | Uso de endpoints internos e contorno da detecção de bot | Risco de conta | Documentado |

## Achados

### 1. Cookies enviados pra domínio arbitrário (Alta)

`request()` aceitava qualquer URL absoluta (`path.startsWith('http')`) e mandava junto o cabeçalho `Cookie` com a sessão inteira. A ferramenta `get-record`, que veio do twonky4, segue uma URL tirada **da resposta da API** (`sourceDescriptions[].about`). O twonky4 tinha uma trava pra isso, mas o código do Harry não tinha, então juntar os dois sem ela abriria o vazamento.

**Correção:** `request()` recusa qualquer URL que não seja `https://` em `familysearch.org` ou subdomínio (`isFamilySearchUrl`). Isso barra `familysearch.org.evil.com`, `evilfamilysearch.org` e `http://`. Teste: *never sends cookies to a non-FamilySearch URL taken from a response*.

### 2. Redirect pra fora do domínio (Média)

O `fetch` seguia redirects automaticamente, e o servidor ficava dependendo do comportamento interno do Node pra não reenviar o cabeçalho `Cookie` montado à mão num salto pra outro domínio.

**Correção:** os redirects são seguidos manualmente (`redirect: 'manual'`, até 5 saltos), e qualquer salto pra fora do familysearch.org gera erro antes de enviar algo. Teste: *does not follow a redirect off familysearch.org with the session*.

### 3. IDs sem validação no caminho da URL (Média)

`personId` e `recordId` eram interpolados direto em caminhos como `/service/tree/tree-data/v8/person/${personId}/card`. Um valor como `../../outro/endpoint` faria o servidor chamar outro endpoint do FamilySearch com os teus cookies. O ID vem da IA, e a IA lê texto não confiável, como transcrições OCR e notas da árvore.

**Correção:** os IDs são validados duas vezes, no schema zod de cada ferramenta e de novo dentro do cliente (`assertFamilySearchId`), contra o formato `XXXX-XXX`. Qualquer outra coisa é rejeitada antes da requisição. Teste: *rejects malformed IDs before any request is made*.

### 4. Download em pasta arbitrária (Média)

`download-document` aceitava `outputDirectory` livre e criava a pasta com `mkdir -p`. O nome do arquivo já era sanitizado e nunca sobrescrevia nada, mas a pasta podia ser qualquer uma, como a pasta de inicialização do Windows. A `search-full-text` devolve OCR de documentos antigos pra IA, então um texto plantado num documento indexado poderia induzir o modelo a escolher a pasta.

**Correção:** os downloads só são gravados dentro de `~/Downloads/familysearch-mcp` (ou `FAMILYSEARCH_DOWNLOAD_DIR`). `outputDirectory` passou a ser uma subpasta dentro dessa raiz, e `..`, caminho absoluto ou outro drive são rejeitados.

### 5. Dependências vulneráveis (Baixa)

O `npm audit` acusava 8 avisos: `proxy-addr` (crítico), `body-parser`, `path-to-regexp`, `zod`, o próprio `@modelcontextprotocol/sdk` (altos), `qs` e `express` (moderados). Todos estão na pilha HTTP do SDK, que esse servidor não usa porque roda via stdio, ou na validação do zod com coleções enormes. Nenhum era alcançável na prática.

**Correção:** SDK atualizado de 1.7.0 pra 1.32.2 e zod de 3.24 pra 4.6.7. O `npm audit` agora mostra **0 vulnerabilidades**. O shim de tipos `src/mcp-types.d.ts`, que escondia os tipos reais do SDK, foi removido, e o código compila com os tipos reais.

Dependências diretas: `@modelcontextprotocol/sdk`, `playwright` e `zod`. Nenhuma tem script de instalação. O único pacote da árvore com script nativo é o `fsevents`, que é opcional e só existe no macOS (vem do Playwright). O Playwright **não** baixa navegador: os scripts usam o Brave ou o Chrome que já estão instalados.

### 6 e 7. Formato da família (bugs)

O endpoint `family-members` chama os dois membros do casal de `parent1`/`parent2`, tanto nos grupos de pais quanto nos de cônjuge, e embrulha cada filho em `children[].child`. O código original lia `spouse1`/`spouse2` e o filho direto. O izzybps e o twonky4 chegaram nesse formato de forma independente. Com isso:

- `get-descendants` nunca achava filho e misturava irmãos na lista (correção do izzybps).
- `get-person` nunca mostrava a seção de cônjuges e filhos. O fork do Harry tinha o mesmo erro, e essa correção é nova aqui.

### 8. Cookies pela conversa (Baixa, documentado)

`set-session-cookie` recebe a string de cookies como argumento de ferramenta, então ela entra no histórico da conversa e chega ao provedor do modelo. A descrição da ferramenta e o README agora recomendam o `login-with-browser`, que grava direto no arquivo local.

### 9. Permissão do config no Windows (Baixa, documentado)

`config.json` e a pasta são criados com `0600`/`0700`, o que no macOS e no Linux restringe ao teu usuário. No Windows o `chmod` não tem efeito, e a proteção fica por conta das permissões do teu perfil (`C:\Users\<você>`), que já são restritas por padrão. O perfil do navegador de login (`~/.familysearch-mcp/browser-profile`) também guarda a sessão.

### 10. Risco com os termos do FamilySearch (documentado)

O projeto usa os endpoints internos `/service/` do site, não a API pública. Ele também abre o navegador com `--disable-blink-features=AutomationControlled` e um User-Agent de navegador comum pra não ser bloqueado pela proteção anti-bot. Isso funciona, mas está fora das integrações suportadas pelo FamilySearch e pode levar a bloqueio temporário ou a questionamento da conta.

O que reduz o risco, e já vinha do fork do Harry: no mínimo ~4 s entre requisições com variação aleatória, nenhuma nova tentativa no erro 15 (bloqueio de segurança) e pausa de 15 min depois de um bloqueio. Todas as ferramentas são **somente leitura** na árvore.

## Atualização: ferramentas de leitura de fontes e duplicatas

Entraram três ferramentas, todas **somente leitura**, então a regra de que nada altera a árvore continua valendo:

- `get-person-sources`: `GET /platform/tree/persons/{id}/sources`.
- `analyze-merge`: `GET /platform/tree/persons/{sobrevivente}/merges/{duplicata}`. Esse GET só **analisa** a mesclagem; quem executa é o POST no mesmo caminho, e esse POST não existe no código. Teste: *analyzeMerge is a GET dry run*, que confere que nenhuma chamada usa outro método.
- `find-duplicates`: usa só leituras já existentes (`family-members` e o cartão da pessoa), no máximo 6 cartões por chamada pra respeitar o limite de requisições.

Os IDs passam pela mesma validação (`assertFamilySearchId`) e as chamadas pelo mesmo cliente, com limite de taxa, pausa no erro 15 e cookies travados em `familysearch.org`. Por escolha, **não há** ferramenta de mesclar, anexar fonte ou editar: isso fica no site do FamilySearch, onde há confirmação e desfazer.

Verificação ao vivo (10 de novembro de 2026): os dois endpoints `/platform/` foram chamados só com GET, de dentro de uma sessão logada, com o mesmo `Authorization: Bearer <fssessionid>` que o cliente usa. `/sources` respondeu 200 no formato esperado (15 fontes de um mesmo caso real, com link, citação e nota). `/merges/{a}/{b}` respondeu 200 **somente** com `Accept: application/x-fs-v1+json`; com o tipo GEDCOM X vinha 406, bug que os testes simulados não pegaram e que está corrigido. O que **não** foi exercitado ao vivo foi o código TypeScript em si, que ainda roda só contra `fetch` simulado: a primeira chamada real pela ferramenta é a que confirma de ponta a ponta.

## O que foi verificado e está ok

- **Rede:** o único destino no código é `www.familysearch.org` e seus subdomínios. Os scripts Playwright só navegam pra páginas do FamilySearch, e os cookies são injetados com `domain: .familysearch.org` e `secure: true`.
- **Telemetria:** nenhuma. Nada de analytics, de chamada a API de IA de terceiros nem de endpoint externo. A "busca com IA" é o recurso de transcrição do próprio FamilySearch.
- **Processos filhos:** `spawn(process.execPath, [script, JSON])`, sem shell, com caminhos de script fixos e argumentos em JSON. Não há injeção de comando.
- **Arquivos:** o servidor lê e grava só `~/.familysearch-mcp/config.json`, o perfil do navegador de login e a pasta de downloads. Os downloads nunca sobrescrevem arquivo existente.
- **Segredos em log:** cookies e sessão não aparecem em log nem nas respostas das ferramentas.
- **Testes:** 13 testes (`npm test`) cobrem as travas acima, o formato da família, a busca de registros e a pausa contra bloqueio.

## Limites desta auditoria

Os testes rodam com `fetch` simulado. Eles não acessam o FamilySearch de verdade, porque isso exigiria uma sessão logada. Os formatos de resposta da API vêm do código dos forks e do relato dos autores. Como são endpoints internos, o FamilySearch pode mudá-los sem aviso.
