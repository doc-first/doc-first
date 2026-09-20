/**
 * O catálogo de tipos de conteúdo. Todo pedaço validável da documentação é de UM tipo, e cada tipo
 * sabe o que exige de si mesmo.
 *
 * Por que tipificar, e não deixar "um trecho é um trecho": porque a pergunta *"isto está bom?"* não
 * é a mesma para um título e para um diagrama. Um diagrama tem de ser texto para entrar na digital.
 * Uma imagem tem de ter descrição, ou não existe para quem usa leitor de tela. Uma decisão sem dono
 * não é uma decisão pendente — é uma decisão perdida.
 *
 * Sem tipo, essas regras viram convenção oral, e convenção oral morre na terceira pessoa que entra
 * no projeto.
 *
 * ⚠️ Um tipo NÃO muda quem aprova nem como a digital é calculada. Ele muda **o que se cobra** antes
 * de considerar o trecho pronto para aprovação. A trava continua uma só.
 * @module
 */

/**
 * @typedef {{
 *   nome: string,
 *   descricao: string,
 *   numerado: boolean,
 *   exige?: (trecho: {texto: string, html: string, atributos: Record<string,string>}) => string[],
 * }} Tipo
 */

/** Uma exigência que falhou devolve a frase do que fazer, não o nome da regra. */
const vazio = () => [];

/** @type {Record<string, Tipo>} */
export const TIPOS = {
  // ---------------------------------------------------------------- estrutura
  title: {
    nome: 'título',
    descricao: 'o título de uma página ou seção. Não mostra número, mas TEM trava: mudar um título '
      + 'muda o sentido de tudo que vem abaixo.',
    numerado: false,
    exige: ({ texto }) => texto.trim().length > 80
      ? ['título com mais de 80 caracteres — provavelmente é um parágrafo disfarçado'] : [],
  },
  subtitle: {
    nome: 'subtítulo',
    descricao: 'a linha que explica a seção em uma frase, logo abaixo do título.',
    numerado: false,
    exige: vazio,
  },

  // ---------------------------------------------------------------- texto
  text: {
    nome: 'texto',
    descricao: 'um parágrafo. O tipo mais comum, e o padrão de quem não declara nada.',
    numerado: true,
    exige: vazio,
  },
  list: {
    nome: 'lista',
    descricao: 'itens em sequência. Uma lista de um item só é um parágrafo mal vestido.',
    numerado: true,
    exige: ({ html }) => (html.match(/<li\b/g) ?? []).length < 2
      ? ['lista com menos de dois itens — ou vire parágrafo, ou acrescente o resto'] : [],
  },
  box: {
    nome: 'caixa de informação',
    descricao: 'um aviso, uma ressalva, uma nota. Precisa dizer de que tipo é — info, alerta, '
      + 'proibição —, senão vira só um parágrafo com borda.',
    numerado: true,
    exige: ({ atributos }) => atributos['data-box'] ? []
      : ['caixa sem data-box: diga se é info, alerta, ok ou proibido'],
  },
  table: {
    nome: 'tabela',
    descricao: 'dados em linhas e colunas. Toda tabela precisa de cabeçalho — sem ele, ninguém '
      + 'que use leitor de tela sabe o que cada célula significa.',
    numerado: true,
    exige: ({ html }) => /<th\b/.test(html) ? []
      : ['tabela sem <th>: sem cabeçalho, a tabela não é legível por leitor de tela'],
  },

  // ---------------------------------------------------------------- visual
  image: {
    nome: 'imagem',
    descricao: 'uma figura. ⚠️ O texto dentro de uma imagem NÃO entra na digital — mudar a imagem '
      + 'não muda a digital do trecho, e por isso a descrição é obrigatória: é ela que é revisável.',
    numerado: true,
    exige: ({ html }) => {
      const faltas = [];
      if (/<img\b/.test(html) && !/\balt="[^"]+"/.test(html)) {
        faltas.push('imagem sem alt: descreva o que ela mostra — é a única parte dela que entra na trava');
      }
      return faltas;
    },
  },
  diagram: {
    nome: 'diagrama',
    descricao: 'um fluxo, um modelo, uma arquitetura — EM TEXTO (Mermaid, PlantUML). '
      + 'Diagrama como imagem não tem digital útil: recomprimir muda os bytes sem mudar o sentido, '
      + 'e mudar o sentido não aparece no diff.',
    numerado: true,
    exige: ({ html }) => /<img\b/.test(html)
      ? ['diagrama como imagem: use Mermaid ou PlantUML em <code>, para o diagrama entrar na trava']
      : [],
  },
  colors: {
    nome: 'paleta',
    descricao: 'cores da marca, com o valor junto. "Azul primário" não é um valor; "#0883C5" é.',
    numerado: true,
    exige: ({ texto }) => /#[0-9a-fA-F]{3,8}\b|\b(rgb|hsl|oklch)\(/.test(texto) ? []
      : ['paleta sem nenhum valor de cor: escreva o hexadecimal, não só o nome'],
  },

  // ---------------------------------------------------------------- técnico
  config: {
    nome: 'configuração',
    descricao: 'uma variável, um parâmetro, um valor que muda por ambiente.',
    numerado: true,
    exige: vazio,
  },
  contract: {
    nome: 'contrato',
    descricao: 'uma rota, um evento, um payload. É promessa pública: quebrar aqui quebra o sistema '
      + 'de outra pessoa.',
    numerado: true,
    exige: vazio,
  },
  model: {
    nome: 'modelagem',
    descricao: 'uma entidade, um relacionamento, um campo do dicionário de dados.',
    numerado: true,
    exige: vazio,
  },

  // ---------------------------------------------------------------- decisão
  rationale: {
    nome: 'justificativa',
    descricao: 'por que foi assim, e o que foi descartado. A alternativa descartada é a parte que '
      + 'mais vale: ela prova que houve escolha, e não inércia.',
    numerado: true,
    exige: vazio,
  },
  decision: {
    nome: 'decisão pendente',
    descricao: 'o que falta decidir. Sem dono e sem prazo não é pendência — é decisão perdida.',
    numerado: true,
    exige: ({ atributos }) => {
      const faltas = [];
      if (!atributos['data-dono']) faltas.push('decisão sem data-dono: quem decide isto?');
      if (!atributos['data-prazo']) faltas.push('decisão sem data-prazo: até quando?');
      return faltas;
    },
  },
};

export const PADRAO = 'text';

/**
 * O tipo de um trecho: o que ele declara, ou o que dá para deduzir de como foi escrito.
 *
 * A dedução existe para o método não começar cobrando: documentação que já existe passa a ter tipo
 * sem ninguém reescrever nada, e quem quiser precisão declara.
 *
 * @param {{ atributos: Record<string,string>, classes: string[], tag: string, html: string }} t
 */
export function tipoDe(t) {
  const declarado = t.atributos['data-tipo'];
  if (declarado && TIPOS[declarado]) return declarado;
  if (declarado) return PADRAO;                       // tipo inventado: cai no padrão, e o lint acusa

  const cod = t.atributos['data-cod'] ?? '';
  if (/\.titulo$/.test(cod) || /^h[1-3]$/.test(t.tag)) return 'title';
  if (/\.sub$/.test(cod) || t.classes.includes('lead-secao')) return 'subtitle';

  if (/class="mermaid"|<pre\b/.test(t.html)) return 'diagram';
  if (/<table\b/.test(t.html)) return 'table';
  if (/<img\b/.test(t.html)) return 'image';
  if (/<[uo]l\b/.test(t.html)) return 'list';
  if (t.classes.some((c) => c.startsWith('caixa'))) return 'box';
  return PADRAO;
}

/** O que falta neste trecho para ele estar pronto para aprovação. */
export function oQueFalta(tipo, trecho) {
  const t = TIPOS[tipo];
  if (!t) return [`tipo desconhecido: "${tipo}" — veja review/core/kinds.js`];
  return t.exige ? t.exige(trecho) : [];
}

/** Os tipos existentes, para o catálogo e para o `doc-first tipos`. */
export const catalogo = () =>
  Object.entries(TIPOS).map(([id, t]) => ({ id, ...t, exige: undefined }));
