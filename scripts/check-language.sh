#!/usr/bin/env bash
# Are the comments in English?
#
#   bash scripts/check-language.sh --comments=en  $(git diff --cached --name-only)
#   bash scripts/check-language.sh --comments=any $(git diff --cached --name-only)
#
# Why a script and not a convention: "we write in English here" holds while the three people who
# agreed to it are still around. This repository is public and expects contributors who never read
# the agreement, so the rule has to be something a machine says at the moment it is broken, rather
# than something a reviewer says a week later.
#
#   --comments=en    comments must be English too. The public engine.
#   --comments=any   comments in whatever the team speaks. A product repository with a Brazilian
#                    team is a legitimate case: the code travels, the reasoning stays with the
#                    people who wrote it.
#
# ⚠️ Built to be QUIET, and the first version was not. It flagged thirteen files of this very
# repository, and every single hit was wrong. Two lessons are baked in below:
#
#   1. This codebase QUOTES Portuguese identifiers in backticks while explaining them in English —
#      "the KEYS of `doc-first.json` are still Portuguese (`nome`)". Backtick content is stripped
#      before anything is judged, or the checker punishes the comments that do the most good.
#   2. One Portuguese-looking word means nothing; `senha`, `pessoa` and `pagina` are contract
#      identifiers this project keeps on purpose. Only GRAMMAR words count, and only when TWO
#      DIFFERENT ones show up in the same comment. A Portuguese sentence has many. An English
#      sentence about Portuguese code has one.
#
# A checker with false positives is a checker someone turns off, and then it protects nothing.
set -uo pipefail

COMMENTS=en
FILES=()
for arg in "$@"; do
  case "$arg" in
    --comments=*) COMMENTS="${arg#*=}" ;;
    *) FILES+=("$arg") ;;
  esac
done
[ ${#FILES[@]} -eq 0 ] || [ "$COMMENTS" = any ] && { [ "$COMMENTS" = any ] && exit 0; }
[ ${#FILES[@]} -eq 0 ] && exit 0

# Grammar words only. No nouns: a noun is how you get a false positive, because half of them are
# also identifiers this project deliberately keeps.
GRAMMAR='não|nao|está|estão|estao|também|tambem|então|entao|porque|porém|porem|quando|onde|isso|isto|aquilo|dele|dela|deles|delas|pelo|pela|pelos|pelas|seu|sua|seus|suas|nosso|nossa|mesmo|mesma|outro|outra|aqui|ali|agora|depois|antes|sempre|nunca|talvez|ainda|já|mas|pois|assim|cada|todo|toda|todos|todas|muito|muita|pouco|pouca|qualquer|nenhum|nenhuma|algum|alguma|quem|cujo|cuja'

FAILURES=0

for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  case "$f" in
    *node_modules/*|*painel-react.js) continue ;;   # generated or vendored
    */locales/*) continue ;;                        # translations ARE other languages
    */cycle.json) continue ;;                       # labels a Brazilian reviewer reads
    *examples/*) continue ;;                        # demonstration content, not engine
  esac
  case "$f" in
    *.ts|*.js|*.jsx|*.mjs|*.sh) ;;
    *) continue ;;
  esac

  # Comment lines only, with backtick content and quoted strings removed first.
  HITS=$(sed -E 's/`[^`]*`//g; s/"[^"]*"//g; '"s/'[^']*'//g" "$f" 2>/dev/null \
    | grep -nE '^[[:space:]]*(//|#|\*|/\*)' 2>/dev/null \
    | grep -iEc "($GRAMMAR)" 2>/dev/null || true)

  # Two DIFFERENT grammar words in the file's comments. One is an accident; two is a sentence.
  DISTINCT=$(sed -E 's/`[^`]*`//g; s/"[^"]*"//g; '"s/'[^']*'//g" "$f" 2>/dev/null \
    | grep -E '^[[:space:]]*(//|#|\*|/\*)' 2>/dev/null \
    | grep -ioE "\b($GRAMMAR)\b" 2>/dev/null | sort -u | wc -l)

  if [ "${DISTINCT:-0}" -ge 2 ]; then
    echo "  ✗ $f — the comments look like Portuguese ($DISTINCT grammar words)"
    sed -E 's/`[^`]*`//g' "$f" | grep -nE '^[[:space:]]*(//|#|\*|/\*)' \
      | grep -iE "\b($GRAMMAR)\b" | head -2 | sed 's/^/        /' | cut -c1-120
    FAILURES=$((FAILURES+1))
  fi
done

if [ $FAILURES -gt 0 ]; then
  echo ""
  echo "  This repository is written in English, comments included. See CONTRIBUTING.md."
  echo "  A real exception goes in the exclusion list at the top of this script, with the reason."
  exit 1
fi
exit 0
