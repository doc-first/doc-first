# Doc First

Documentação revisável, com aprovação rastreável. Você escreve a documentação em HTML, sobe esta
imagem, e quem revisa aprova trecho por trecho no navegador — com o registro de quem aprovou, quando,
e **sobre qual texto exato**.

O ponto todo está nessa última parte. A aprovação vale para o texto, não para o trecho: mude uma
letra e a aprovação deixa de valer, porque ninguém aprovou o texto novo.

## Em dois minutos

```bash
git clone https://github.com/Garbiati/doc-first
cd doc-first
REVISAO_OWNER=voce@exemplo.org docker compose up
```

Abra `http://localhost:8080`. A senha do primeiro acesso aparece **uma vez** no log, e o primeiro
login obriga a trocá-la. Não existe `admin/admin`: ferramenta interna fica anos no ar.

Você vai cair no `examples/ola-mundo` — duas páginas que explicam, no próprio texto, tudo o que uma
documentação precisa ter para funcionar aqui.

## Para a sua documentação

```bash
docker run -p 8080:8080 -v dados:/dados \
  -v "$PWD/minha-doc:/conteudo" -e REVISAO_SITE=/conteudo \
  -e REVISAO_OWNER=voce@exemplo.org doc-first
```

`minha-doc/` precisa de um `doc-first.json` dizendo onde as páginas estão. Copie
`examples/ola-mundo/` e edite — é o caminho mais curto.

## O que a sua página precisa ter

O painel de revisão **se desliga em silêncio** se faltar qualquer um destes itens. É de propósito:
melhor não aparecer do que aparecer errado.

| # | Exigência |
|---|---|
| 1 | Um elemento `.doc-titulo__cod` com o código da página (`A01`) |
| 2 | Um `<main>`. Nada fora dele é revisável |
| 3 | Cada trecho com `data-id` **e** `data-cod` |
| 4 | `data-cod` no formato `seção.número` (`1.2`). `1.titulo` não ganha botão |
| 5 | O trecho com `position: relative` no CSS |
| 6 | **Tudo que o JavaScript injetar dentro de `<main>` com `data-revisao-ui`** |
| 7 | Carregar `common.js`, `review.js` e `core-web.js`, nessa ordem |
| 8 | Carregar `painel.css` |

O item 6 é o que mais dói quando se esquece: o texto injetado entra na conta da digital e derruba
**todas** as aprovações da página de uma vez, sem erro nenhum. `examples/ola-mundo/paginas/A01.html`
tem isso comentado no lugar em que acontece.

## Como fica guardado

Nada se apaga. Cada ✓, cada pedido, cada recusa vira um evento novo com autor e hora. O banco
recusa `UPDATE` e `DELETE` — por gatilho, não por disciplina.

Por padrão os eventos ficam num arquivo SQLite no volume `/dados`. A mesma interface (`Registro`,
cinco métodos) aceita Postgres, MySQL ou Firestore.

## A ferramenta de quem aplica os pedidos

```bash
docker run --rm -v "$PWD:/work" -w /work --user "$(id -u):$(id -g)" doc-first \
  node review/cli/doc-first.ts listar
```

| Comando | O que faz |
|---|---|
| `sincronizar` | traz para o repositório os ✓ dados no site |
| `listar` | os pedidos aprovados, a aplicar |
| `ver <id>` | o pedido, o texto de então e o de agora |
| `impacto <id>` | onde mais o assunto aparece, e o que está validado |
| `estado <id> …` | registra o andamento (quem pediu vê no painel) |
| `conferir` | trecho validado que mudou, e aprovação sem rastro |

A separação de poderes é testada: **o agente aplica, mas não aprova.** Triagem é de quem é dono.

## O que ainda não funciona

Honestidade sobre o estado, em `2026-09-20`:

- **O menu lateral e a fila de triagem não vieram ainda.** O `shell.js` do projeto de origem traz o
  nome do produto e as rotas dele escritos no código. A triagem funciona dentro do painel, em cada
  trecho; a fila consolidada volta quando o menu virar configuração.
- **Os geradores ainda são Python** e ficaram no projeto de origem: numerar trechos, gerar índice,
  gerar PDF. A numeração (`marcar_ids.py`) é a que mais falta aqui.
- **A ajuda de IA está desenhada, não construída.** O `.env.example` já reserva o lugar da chave.
- **Só identidade por senha e por IAP.** Falta OIDC, Google e LDAP — a interface existe, a peça não.
- **Sem imagem publicada** em registry. Por ora é `docker build` no clone.

## Licença

MIT. Veja `LICENSE`.
