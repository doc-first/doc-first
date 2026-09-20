# Doc First — documentação viva

> Proposta · `2026-09-20` · nada aqui está pronto, e boa parte não está começada.

## O problema

Documentação de produto morre de um jeito conhecido: alguém escreve, alguém aprova, e seis meses
depois ninguém sabe mais o que ainda é verdade. Não porque as pessoas sejam desleixadas — porque
**nada avisa**. O documento não sabe que o código mudou. O caso de uso não sabe que a regra mudou.
O diagrama não sabe que a tela mudou.

O resultado é sempre o mesmo: a documentação vira arqueologia, e a decisão volta a morar só na
cabeça de quem estava lá.

## A ideia em uma frase

**A documentação é gerada a partir do negócio, e validada por um humano — e cada pedaço dela sabe
dizer se ainda pode ser confiado.**

Não é "gerar documentação automaticamente". Isso já existe e produz texto que ninguém lê. É gerar
**e manter honesto**: quando algo muda, tudo que dependia daquilo levanta a mão.

## O semáforo

O coração do método. Cada trecho de documentação tem um estado, e o estado é calculado, nunca
declarado por alguém.

| | Estado | O que significa | O que fazer |
|---|---|---|---|
| ⚪ | não validado | ninguém olhou ainda | ler e aprovar, ou pedir alteração |
| 🟢 | validado | aprovado, e nada mudou desde então | nada |
| 🟡 | vencido | o texto **deste** trecho mudou depois do ✓ | reaprovar o texto novo |
| 🔴 | suspeito | o texto está igual, mas mudou algo de que ele **depende** | conferir se ainda é verdade |

O vermelho é o que separa este método de um controle de versão com selo. Ele pega o caso que
ninguém percebe lendo a página, porque **na página nada mudou**.

### Por que vermelho é pergunta, não erro

O motor não sabe se o trecho ficou errado. Sabe que ficou **suspeito**, e que um humano precisa
olhar. Se tratássemos como erro, a primeira leva de falsos positivos faria alguém desligar a
checagem — e aí a trava inteira perde o sentido.

*Estado:* ⚪ ⟶ 🟢 ⟶ 🟡 implementados desde o começo; 🔴 implementado em `2026-09-20`.

## O que a ferramenta gera, e o que o humano faz

```
  o negócio muda
        │
        ▼
  ┌─────────────────────┐
  │ a ferramenta gera   │   texto, fluxograma, C4, caso de uso, modelo
  │ ou atualiza         │
  └─────────┬───────────┘
            │
            ▼
  ┌─────────────────────┐
  │ tudo que dependia   │   🟡 e 🔴 aparecem sozinhos
  │ levanta a mão       │
  └─────────┬───────────┘
            │
            ▼
  ┌─────────────────────┐
  │ o humano confere    │   ✓ ou "isto aqui está errado porque…"
  │ e aprova            │
  └─────────────────────┘
```

A máquina nunca aprova. **Aprovação é humana, sempre** — é a única parte do método que não se
automatiza, e é de onde vem todo o valor do resto.

## As categorias de documentação

O gabarito (`examples/gabarito/`) é o esqueleto que um projeto copia. Ele cresce conforme o método
amadurece; hoje tem cinco seções, e a lista abaixo é o destino.

| Seção | O que guarda | Estado |
|---|---|---|
| **Discovery** | por que existe, para quem, o que muda se der certo | ✅ |
| **Papéis** | quem pode o quê, a tabela de capacidades, quem aprova | ✅ |
| **Design system** | os valores, os componentes, e o que não fazemos | ✅ |
| **Telas** | o que a pessoa vem fazer, o que vê, o que pode, o protótipo | ✅ |
| **Decisões** | o que falta decidir, com dono e prazo | ✅ |
| **Stack** | de que o sistema é feito, e por quê | ⬜ |
| **Modelagem** | as entidades, os relacionamentos, o dicionário de dados | ⬜ |
| **Casos de uso** | o fluxo ponta a ponta, com o que trafega em cada passo | ⬜ |
| **Arquitetura (C4)** | contexto, contêineres, componentes, código | ⬜ |
| **Contratos** | as APIs, os eventos, o que entra e o que sai | ⬜ |

## Os diagramas

**Decisão:** diagrama é **texto**, não imagem. Mermaid, PlantUML ou equivalente — algo que se
versiona, se compara num diff, e de que se calcula digital.

Isso não é preferência estética. Um PNG não tem digital útil: qualquer recompressão muda os bytes
sem mudar o significado, e nenhuma mudança de significado é legível num diff. Um diagrama em texto
entra no semáforo como qualquer outro trecho — e é a única forma de um fluxograma ficar 🟡 quando o
fluxo que ele desenha mudou.

*Estado:* ⬜ não começado.

## O que o protótipo é, e o que não é

**Decisão do Ale, `2026-09-20`:** o protótipo das telas fica em **HTML e CSS**, não no framework do
produto.

O motivo é o mesmo que o do diagrama em texto: quem adota o método pode usar React, Vue, Svelte ou
nada disso. O Doc First não pode impor framework à documentação de ninguém. O painel de revisão —
que é **do motor** — é React; a tela documentada é de quem escreve.

## Quem faz o quê

| | Doc First | O projeto que adota |
|---|---|---|
| A regra | ciclo, semáforo, trava por digital, papéis | — |
| A ferramenta | painel, CLI, imagem, geradores | — |
| O gabarito | o esqueleto vazio | o conteúdo preenchido |
| A marca | — | cores, fonte, ícones, nome |
| As pessoas | — | quem aprova, quem revisa |

**Melhoria de método sobe para cá. Conteúdo fica lá.** É a regra que impede o motor de virar o
produto de alguém outra vez.

## O que ainda não existe

Em ordem do que falta mais:

1. **Geração.** Hoje o humano escreve e a ferramenta guarda. A visão é a ferramenta escrever a
   primeira versão a partir do negócio, e o humano corrigir.
2. **Diagramas.** Nenhum. Nem gerados, nem versionados, nem no semáforo.
3. **As cinco categorias que faltam** — stack, modelagem, casos de uso, C4, contratos.
4. **Dependência automática.** Hoje `data-depende` é escrito à mão. A ferramenta deveria propor:
   dois trechos que falam do mesmo termo provavelmente dependem um do outro.
5. **A fila consolidada** — ver tudo que está 🟡 e 🔴 num lugar só, sem abrir página por página.
6. **A ajuda de IA.** Cada projeto com a própria chave. Desenhada, não construída.

## O nome

"Doc First" é nome de trabalho, como todo nome de trabalho. Ele descreve a ordem — documentação
antes do código —, mas não descreve a parte que importa, que é a documentação **continuar
verdadeira** depois. Quando aparecer um nome melhor, troca.
