---
name: doc-first
description: A metodologia Doc First — documentação revisável com aprovação rastreável. Use ao retomar o trabalho na documentação, ao aplicar um pedido de revisor, ao sincronizar as aprovações do site, ou quando alguém perguntar como o método funciona. Também ao começar a documentar um produto novo com este método.
---

# Doc First — documentação que é revisada, não só escrita

Este arquivo vem **dentro do repositório**. Quem clonar o projeto recebe o método, a ferramenta e o
agente juntos — antes, a skill morava fora e o método chegava sem o agente que o executa.

## O que o método é, em cinco linhas

A documentação é escrita **antes** do código e revisada por quem entende do assunto, não por quem
programa. Cada trecho tem um código estável e uma **digital do texto**: a aprovação vale para aquele
texto, e cai sozinha se o texto mudar. Os revisores **pedem alteração** no site; **só o agente
altera**, com análise de impacto e commit rastreável. O git é a fonte do conteúdo; o site nunca edita.

## Ao retomar o trabalho — faça nesta ordem

```bash
node review/cli/doc-first.ts sincronizar   # traz os ✓ que o dono deu no site
node review/cli/doc-first.ts listar        # pedidos aprovados, a aplicar
node review/cli/doc-first.ts conferir      # nada validado mudou sem permissão?
```

Diga ao dono, em poucas linhas: quantos trechos novos foram validados, quantos pedidos há para
aplicar e de quem. **Nunca proponha validar trecho por trecho no chat** — a validação acontece no site.

## Ao aplicar um pedido

1. `doc-first ver <id>` — o que foi pedido, o texto de então e o de agora, e a conversa.
2. `doc-first estado <id> analise "Recebido…"` — o revisor vê o andamento no painel.
3. `doc-first impacto <id> --termo "…"` — **onde mais o assunto aparece**. Nunca altere sem isto:
   o comando marca quais trechos estão **validados**, e esses exigem permissão do dono para mudar.
4. Pergunte o que for ambíguo. Um pedido mal entendido vira dois pedidos.
5. Aplique, com commit contendo os trailers `Pedido: <id>` e `Solicitado-por: <e-mail>`.
6. `doc-first estado <id> aplicado "Feito" --commit <sha> --trechos D01.1.4,D02.3.1`
7. Registre a lição em `docs/LICOES-DE-REVISAO.md` se a correção ensinar alguma regra.

## As regras que não se negociam

1. **O git é a fonte.** Nada altera conteúdo fora de commit. O site só lê e registra eventos.
2. **Os eventos não se apagam.** Aprovou, pediu, comentou, recusou — cada um com quem, quando, onde
   e a digital do texto naquele instante.
3. **A aprovação vale para um texto, não para um trecho.** Mudou o texto, a aprovação cai sozinha.
4. **Só owner e admin aprovam.** O ✓ deles vira trava no repositório e manda o agente aplicar.
   Revisor pede alteração, comenta e responde decisão.
5. **Pedido de quem pode aprovar nasce aprovado.** Ninguém tria a si mesmo.
6. **Impacto antes de alterar.** O agente nunca aplica um pedido sem procurar onde mais ele toca.
7. **Nada está aprovado até estar validado.** Escreva sempre como proposta.

## Onde as coisas estão

| O quê | Onde |
|---|---|
| A regra do ciclo (estados, transições) | `review/cycle.json` — dado, não código |
| Núcleo compartilhado (digital, ciclo, papéis, limites) | `review/core/` — roda no navegador **e** no servidor |
| API e site | `review/api/` (TypeScript, sem build) |
| Ferramenta do agente | `review/cli/doc-first.ts` |
| O método por escrito | `docs/METHOD.md` |
| Dívida conhecida | `docs/DIVIDA-TECNICA.md` |

## Armadilhas que já custaram caro aqui

- **Porta ocupada = binário velho.** Se `rodar-local.sh` recusar subir, mate o processo antes. Testar
  o código antigo sem perceber já quase fez desfazer uma correção que estava certa.
- **`element.focus()` não ativa `:focus-visible`.** Foco se testa com Tab.
- **Teste que passa por motivo errado.** Uma asserção que fazia `grep` na saída acusava falha com
  tudo passando. Prefira código de saída a texto.
- **Aprovação forjada.** Um `data-validado` escrito à mão criava aprovação do nada; hoje `conferir`
  pega, mas a lição fica: a trava tem de olhar os dois lados.
