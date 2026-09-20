# Doc First — documentação revisável, com aprovação rastreável.
#
# Sobe, entra com usuário e senha, e está pronto. Sem nuvem, sem provedor de identidade, sem banco
# para instalar.
#
#   docker build -t doc-first .
#   docker run -p 8080:8080 -v dados:/dados -e REVISAO_OWNER=voce@exemplo.org doc-first
#
# A senha do primeiro acesso aparece UMA vez no log, e o primeiro login obriga a trocá-la. Não
# existe admin/admin: ferramenta interna fica anos no ar.
#
# Para apontar para a SUA documentação, monte-a e diga onde ela está:
#
#   docker run -p 8080:8080 -v dados:/dados \
#     -v "$PWD/minha-doc:/conteudo" -e REVISAO_SITE=/conteudo \
#     -e REVISAO_OWNER=voce@exemplo.org doc-first
#
# `/conteudo` precisa ter um doc-first.json. Veja examples/ola-mundo/ para o mínimo que funciona.

# Base por DIGEST, não por tag: `node:24-alpine` muda sozinho a cada patch, e a imagem mudaria sem
# nenhum commit — nada acusaria.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
WORKDIR /app
ENV NODE_ENV=production

# As dependências primeiro, para aproveitar a camada quando só o código mudar.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Sem passo de build: o Node 22+ roda TypeScript direto (type stripping). Não há tsc, bundler nem
# dist/. Quem adota clona e roda.
COPY review ./review
COPY examples ./examples
COPY doc-first.json ./doc-first.json

# O banco fica FORA de /app, em volume. Sem isto o SQLite grava numa camada do contêiner: o serviço
# sobe, responde, aceita aprovação — e perde tudo ao recriar.
# ⚠️ Com PASTA DO HOST em vez de volume nomeado, o dono vem do host e este chown não alcança. Use
# volume nomeado, ou `sudo chown 1000:1000` na pasta.
RUN mkdir -p /dados && chown -R node:node /dados
VOLUME /dados

ENV PORT=8080 \
    REVISAO_SITE=/app/examples/ola-mundo \
    REVISAO_SQLITE=/dados/eventos.db \
    REVISAO_PESSOAS=/dados/pessoas.db

EXPOSE 8080
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "review/api/server.ts"]
