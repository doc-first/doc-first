# Doc First — documentação rica, colaborativa e rastreável antes do app

> **INTERNO** · proposta · `2026-09-17` · definida pelo Ale durante o Arautos.
> A ideia: antes de construir o projeto ou o app, construir a **documentação do sistema pleno**,
> revisada por quem entende do assunto, com registro de **quem pediu, quando, o quê e por quê**.
> O Arautos é o primeiro uso. O método tem de ser replicável em outro projeto sem reescrever nada.

## O ciclo

```
Escrever (agente + Ale)  →  Publicar sob demanda  →  Revisar (pessoas, no site)
        ↑                                                     │
        └──── Aplicar com análise de impacto (agente) ←── Pedido registrado
```

| Etapa | Quem | Como |
|---|---|---|
| **Escrever** | agente com o Ale | páginas no padrão aprovado (`PADRAO-DOCUMENTO.md`), caixas numeradas, lições (`LICOES-DE-REVISAO.md`) |
| **Publicar** | o Ale decide quando | `gh workflow run publicar-leitura.yml` — junta mudanças, publica de uma vez |
| **Revisar** | revisores liberados (ex.: Dra. a revisora) | no site, em cada caixa: **Aprovar · Pedir alteração · Comentar**; responder decisões em aberto |
| **Aplicar** | **só o agente**, com o Ale | lê o pedido, **analisa o impacto** (termo em outras páginas, caso de uso que outras partes usam, aprovações que cairão), pergunta o que for ambíguo, aplica, commita com `Pedido:` e `Solicitado-por:`, marca o pedido como aplicado |
| **Aprender** | agente | padrão de correção vira lição; preferência de revisor vira memória |

## Regras do método

1. **O git é a fonte do conteúdo.** Nada altera página fora de commit. O site nunca edita conteúdo.
2. **Revisão é registro de eventos que não se apagam.** Aprovou, pediu, comentou, respondeu, aplicou,
   recusou — cada um com **quem** (identidade verificada), **quando** (servidor), **onde** (página e
   caixa) e **a digital do texto** naquele momento.
3. **Aprovação vale para um texto, não para uma caixa.** Mudou o texto, a aprovação cai sozinha.
3b. **Aprovar é de owner e admin** (decisão do Ale, `2026-09-17`). O ✓ deles não é opinião: vira **trava
   no repositório** e manda o agente aplicar. Revisor **pede alteração, comenta e responde decisão**; a
   API recusa `aprovacao` de quem não é admin (403), e o site nem mostra o botão. *Hoje não existe
   nenhum admin além do owner — na prática, quem aprova é o Ale.*
3c. **Pedido de owner ou admin nasce aprovado.** Não se tria a si mesmo. Vale igual para o pedido feito
   no site e para o pedido feito direto na conversa com o agente.
4. **Toda alteração nasce de um pedido ou de uma sessão com o Ale**, e o commit diz qual.
5. **Impacto antes de alterar.** O agente nunca aplica um pedido sem procurar onde mais ele toca.
6. **Custo mínimo.** Tudo dentro de cotas grátis enquanto for ferramenta interna.

## Ciclo do pedido (triagem do dono antes do agente)

```
revisor pede ──► Para triar ──► dono: Aprovar ──► agente: Em aplicação ──► Aplicado (commit)
                     │  ▲
                     │  └── revisor/dono acrescenta detalhes
                     ▼
               dono: Recusar (motivo) · Perguntar ──► pode rever e Aprovar
```

- **Quem tria** = **owner ou admin** (`Papeis.cs`). A API recusa de outros (403). Hoje só existe o owner.
- **Recusado pode ser revisto**: quem pediu acrescenta detalhes (volta a "Para triar") ou o dono aprova direto.
- **Aprovado nunca volta** a recusado nem aceita complemento. Mudar algo aprovado = **novo pedido** ligado ao anterior (`dados.relacionado`), mesmo que seja voltar ao texto de antes.
- **Foto do texto**: todo pedido e aprovação guardam o texto da caixa no instante. O git continua sendo o histórico de versões; a foto mostra *o que* foi aprovado ou pedido.
- Página de triagem: `front/triagem.html` (`arautos-doc --triagem`).

## Papéis do sistema (Ale, `2026-09-17`)

"Se a doc faz parte do sistema, já estamos falando em **roles**." Então a revisão não tem lista própria
de gente: usa os papéis do sistema, que **vão para o Keycloak** quando ele existir — e aí só `Papeis.cs`
muda, porque ninguém mais pergunta quem é quem.

| Quem | De onde vem | Pode |
|---|---|---|
| **owner** | metodologia | **um, sempre o mesmo** — o arquiteto fundador (`a.garbiati@…`). Tudo, inclusive criar as roles |
| **admin** *(papel do Arautos)* | role do projeto, com a capacidade de aprovar | tudo o que o owner faz, **menos ser owner** ou trocar quem é. Hoje: nenhum |
| **gestor médico** *(papel do Arautos)* | role com a tag `founder` — Dra. a revisora | ver a Fundamental inteira, pedir alteração, comentar, responder decisão |

- **Owner único é invariante, não convenção:** configuração com zero ou dois owners **não sobe o
  serviço**, com mensagem de erro legível. Está testado.
- **O owner é admin por consequência**, não por configuração — não há como tirar o poder dele por engano.
- Hoje não existe admin nenhum, então "só o Ale aprova" continua verdade sem precisar de exceção no código.

**Da metodologia, só `owner` e `founder`** (Ale, `2026-09-17`). **`admin`, `gestor médico`, `operador`,
`auditor` — esses são papéis do Arautos**, de quem aplica o método. Quem adotar o Doc First noutro
projeto traz as próprias roles e recebe apenas estas duas peças:

| Peça | De quem | Regra |
|---|---|---|
| **owner** | **metodologia** | um só, sempre o mesmo. É quem **cria as roles**. Zero ou dois **não sobem o serviço** |
| **tag `founder`** | **metodologia** | fica **na role, não na pessoa**. Dá o poder de **ver a documentação inteira** |
| **role** | do projeto | dado que o owner cria e nomeia. No Arautos: admin, gestor médico, gestor, operador, médico, enfermeiro, auditor |
| **capacidade** | metodologia define, projeto atribui | **ver · pedir · aprovar**. A tag `founder` dá ver e pedir; **aprovar** é do owner e de quem ele der. No Arautos, quem aprova é o `admin` |

- A tag é da role e não da pessoa porque assim o **segundo** titular daquele papel também vê a
  documentação, sem precisar ser chamado de fundador nem abrir exceção.
- ⚠️ **Gargalo conhecido (Ale, `2026-09-17`):** hoje aprovar **e** implementar passam pelo owner. O
  `admin` já resolve a metade de aprovar — falta desenhar quem pode **implementar** (rodar o agente),
  que hoje não é permissão do sistema e sim quem tem o repositório na mão. **A pensar mais para
  frente**, sem bloquear nada agora.
- **Quem vê a Fundamental** é quem tem role com a **tag `founder`** — a tag fica na role, não na
  pessoa, então o segundo gestor médico também vê. Ver, pedir e aprovar são três poderes: a tag dá os
  dois primeiros. Modelo em `MODELO-tenancy-e-compartilhamento.md`.
- **O motor só conhece owner, admin e "outro".** O papel de **produto** de quem não é admin — Gestor,
  Gestor Médico, Operador, Médico, Enfermeiro, Auditor (folha D03) — é do Arautos e virá do Keycloak.
  Se o motor nomeasse papel de produto, deixaria de ser motor.

## Como o ✓ do Ale volta para o repositório

O Ale **valida no site, não no terminal** (decisão dele, `2026-09-17`): "a validação acontece no site;
aqui a gente só constrói". O site não escreve no repositório — quem fecha o caminho é o agente:

```
Ale clica ✓ no trecho ──► evento `aprovacao` no Firestore ──► agente: doc-first sincronizar
                                                          ──► docs/validacoes.json + data-validado no HTML
```

- `node review/cli/doc-first.ts sincronizar` — roda no início de toda sessão (a skill `/arautos` já chama).
- **Só o ✓ do dono trava.** Aprovação de revisor é registrada, mas não vira trava no repositório.
- **✓ vencido não trava.** Se o texto mudou depois do clique, o comando avisa e ignora — a trava só
  existe para o texto que ele realmente leu.
- **Duas digitais, de propósito.** `digital_texto` (SHA-256 do texto visível) é a que o navegador
  calcula e a única que casa com o site; `digital` (SHA-256 do HTML) é a única que acusa mudança de
  **formatação** num trecho validado. Guardar as duas liga a trava ao site sem afrouxá-la.
- `validar` no terminal continua existindo, para o caso de o site estar fora do ar. A origem fica
  gravada (`origem: site | terminal`).

## Como o agente aplica um pedido

Ferramenta: `python3 review/cli/doc-first.ts` (nuvem) ou `--local` (servidor do `rodar-local.sh`).

1. **Ver** — `doc-first listar` (só os **aprovados pelo dono**) e `doc-first ver ID`: o que foi pedido, quem, o texto atual da caixa, se a caixa mudou desde o pedido e se é **validada** pelo Ale.
2. **Marcar em análise** — `doc-first estado ID analise "Recebido…"` (o revisor vê no painel).
3. **Analisar impacto** — `doc-first impacto ID --termo "…"` para cada termo/assunto do pedido: caixas das páginas (com marcação de validada e aprovada), telas reais, documentos, decisões. Pensar também em dependência de sentido (remover um caso de uso → o que usa esse caso de uso).
4. **Perguntar ao Ale** o que for ambíguo ou tocar caixa validada ("só nesta caixa ou nas outras N?"). Se a decisão for do revisor, `estado ID aguardando "pergunta"`.
5. **Aplicar** no repositório, rodar `marcar_ids.py` se criou caixa, `doc-first conferir` (caixa validada alterada só com ok do Ale — revalidar), conferir prints.
6. **Commitar** com trailers:
   ```
   Pedido: <id completo>
   Solicitado-por: <e-mail do revisor>
   ```
7. **Fechar** — `doc-first estado ID aplicado "o que mudou" --commit SHA --caixas D01.2.1,D01.2.2` (ou `recusado "motivo"`).
8. **Aprender** — se o pedido revela preferência ou padrão, acrescentar lição em `LICOES-DE-REVISAO.md` ou memória.
9. **Publicar** só quando o Ale pedir (`arautos-doc --publicar`) — até lá, o revisor vê "Aplicado" mas o texto novo ainda não está no site.

## Peças técnicas (replicáveis)

| Peça | Onde | Observação |
|---|---|---|
| Páginas e padrão | `front/telas/`, `front/css/doc.css`, `docs/PADRAO-DOCUMENTO.md` | copiar para outro projeto |
| Numeração e trava | `front/marcar_ids.py`, `review/cli/doc-first.ts` | caixa com código estável e digital |
| Índice e decisões | `front/gerar_index.py`, `docs/decisoes-em-aberto.json` | |
| Serviço de revisão | `review/` — API mínima em .NET + site estático no mesmo contêiner | identidade vem do IAP (JWT assinado) |
| Eventos | Firestore, banco `(default)` (cota grátis), coleção `eventos` (só inclusão) | |
| Publicação | `.github/workflows/publicar-leitura.yml` (manual), WIF sem chave | |
| Acesso | `publicar/liberar.sh` | leitor/revisor por e-mail |
| Ferramenta do agente | `review/cli/doc-first.ts` | listar, ver, impacto, estado, resumo |

## Motor e conteúdo — separar desde agora (Ale, `2026-09-17`)

O Doc First não é do Arautos: é **motor**. A intenção é empacotar e distribuir para a comunidade, com o
Arautos como o primeiro caso de uso, não como o dono. Por isso a fronteira se marca **enquanto se
constrói**, não numa refatoração no fim — separar depois custa muito mais e nunca sai.

| | Motor (vai embora com o método) | Deste projeto (fica) |
|---|---|---|
| Método | ciclo do pedido, trava por digital, "só o dono aprova", eventos que não se apagam | — |
| Código | `review/` (API + `doc-first`), `review/cli/doc-first.ts`, `marcar_ids.py`, `front/js/review.js` | `front/telas/*.html`, `docs/*.md`, `docs/decisoes-em-aberto.json` |
| Identidade e papéis | IAP + `Papeis.cs` (`REVISAO_OWNER`, `REVISAO_ADMINS`) | os e-mails de verdade |
| Marca | — | tema gov.br, Healthicons, nome Arautos, `ProductName` |

**Regra de quem escreve código aqui:** nada do motor pode citar Arautos, o cliente, linha de cuidado ou um
e-mail — o que varia vira configuração (como `REVISAO_OWNER`, `REVISAO_ADMINS` e `ARAUTOS_DONO` já são). Quando algo do
motor precisar saber do produto, o produto passa o valor; o motor não vai buscar.

⚠️ O Ale **não quer pesquisa de metodologias parecidas** antes de o motor existir — construir primeiro,
comparar depois, se for o caso.

## Fatias de construção

1. **Fundação** — API, identidade do IAP, banco de eventos. *(feita, publicada)*
2. **No site** — aprovar e pedir alteração com estado. *(feita, não publicada)*
2b. **Triagem do dono** — aprovar, recusar, perguntar; complemento; foto do texto. *(feita, não publicada)*
3. **Agente** — `doc-first` e fluxo de análise de impacto. *(feita)*
4. **Decisões** — responder decisões em aberto pelo site.
5. **Protótipo navegável** — telas ligadas com dados fictícios.
6. **Método empacotado** — modelo de repositório e guia, com o motor já separado do Arautos
   (ver "Motor e conteúdo"), para distribuir à comunidade.
