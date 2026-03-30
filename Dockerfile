FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
WORKDIR /app

# Instalar dependencias necesarias para Prisma (openssl)
RUN apt-get update -y && apt-get install -y openssl

# Copiar archivos de configuración para instalar dependencias primero (cache)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/contracts/package.json ./packages/contracts/

# Ejecutar la instalación de dependencias
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Copiar el resto del código fuente
COPY . .

# Generar el cliente de Prisma
RUN pnpm --filter backend prisma:generate

# Construir el proyecto (Backend y Frontend)
RUN pnpm run build

# Imagen final para producción
FROM base AS runner
WORKDIR /app

# Instalar openssl para Prisma en la imagen final
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copiar desde la etapa de build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

ENV NODE_ENV=production
ENV PORT=3000

# Exponer el puerto
EXPOSE 3000

# El comando de inicio definido en el root package.json -> pnpm start -> pnpm --filter backend start:prod
CMD ["pnpm", "start"]
