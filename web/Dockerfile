FROM --platform=$BUILDPLATFORM node:24-alpine AS build
RUN npm install --global pnpm@10.23.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/package.json
COPY packages/module-ui-sdk/package.json packages/module-ui-sdk/package.json
RUN pnpm install --frozen-lockfile
COPY web ./web
COPY packages ./packages
RUN pnpm --filter @testflow/web build

FROM nginxinc/nginx-unprivileged:alpine
COPY web/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 8080
