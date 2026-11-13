# syntax=docker/dockerfile:1
FROM node:24-trixie-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM dependencies AS source
COPY . .

FROM source AS build
ARG BASE_PATH=/
ENV BASE_PATH=$BASE_PATH
RUN --network=none npm run check:release

# GitHub Pages consumes exactly these files. No Node service is deployed there.
FROM scratch AS export
COPY --from=build /app/dist/ /

# Optional local/static hosting, matching Genomewalk's file-only preview approach.
FROM node:24-trixie-slim AS site
WORKDIR /app
COPY --from=build /app/dist/ ./dist/
COPY scripts/preview.ts ./scripts/preview.ts
COPY scripts/lib/static-server.ts ./scripts/lib/static-server.ts
COPY package.json ./package.json
USER node
ENV HOST=0.0.0.0 PORT=5173
EXPOSE 5173
CMD ["node", "scripts/preview.ts"]
