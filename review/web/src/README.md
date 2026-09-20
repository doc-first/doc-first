# O painel em React

O painel de revisão, escrito em React. `review/web/painel-react.js` é o resultado empacotado, e é
**versionado de propósito**: o Doc First promete "clona e roda", e um bundle que só existe depois
de `npm install` quebraria essa promessa.

    npm run build:web      # gera review/web/painel-react.js

O CI confere que o gerado está em dia. Mexeu aqui, rode e commite.

## O que mora onde

| Arquivo | O que é |
|---|---|
| `entrada.jsx` | a ponte com a página: acha os trechos, cria os botões, monta o React |
| `Painel.jsx` | a janela: selo, ações, formulário de pedido, histórico |
| `api.js` | as três rotas da API, e a digital (que vem do núcleo, não de uma cópia) |
| `estado.js` | o estado de um trecho a partir dos eventos |

## Duas regras que não se quebram

**O React não é dono da página.** Os botões são criados no DOM da página, não por componente: a
página é de quem adota o método, e pode ser HTML, Astro, Jekyll ou o que for. O React monta só a
janela, num `<div>` no fim do `<body>`.

**Tudo que entra em `<main>` leva `data-revisao-ui`.** O texto injetado entra na conta da digital,
e a digital é o que decide se uma aprovação humana ainda vale. Esquecer isso derruba todas as
aprovações da página de uma vez, sem erro nenhum.

## A triagem, e por que os botões não estão escritos aqui

Quem pode triar vê, em cada pedido, os destinos possíveis — e essa lista vem de `situacao.triagem`,
calculada pelo **servidor**. Não há lista de estados escrita no front.

É o que impede front e servidor de discordarem: num pedido já aprovado a triagem vem vazia, e o
botão "Aprovar" simplesmente não existe, em vez de existir e falhar no clique. E um pedido do
próprio dono nasce aprovado — ele não tria a si mesmo —, então a triagem não aparece.

Recusar e perguntar exigem motivo, e o painel barra antes de chamar a API.

## O que ainda não faz

O menu lateral e a fila de triagem consolidada. Hoje a triagem acontece dentro do painel, trecho a
trecho, o que basta para revisar; falta a visão de "todos os pedidos abertos do projeto".

Os dois painéis convivem: `ola-mundo` usa o clássico (`review.js`), `gabarito` usa o React.
