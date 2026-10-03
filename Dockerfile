# The image of this application. Two stages, as in the repository the
# foundation comes from: built with every tool, shipped without any of them.
#
# The foundation is a submodule on a fixed commit (ADR 0001, ADR 0010 in the
# repository opengewerk). Its packages are members of this workspace and are
# built here from that commit, so an image carries exactly the foundation the
# commit of this repository was tested with. A checkout without the submodule
# fails at the first COPY below, which names one of its files.
#
# What deliberately does not happen here is writing a credential into a layer.
# The image is the same for every installation; addresses, passwords and ports
# arrive at runtime from the environment.

FROM node:24-alpine AS build

WORKDIR /build
RUN corepack enable

# Manifests first, everything else after. When only source changes, the
# install layer stays cached. The three packages of the foundation are listed
# by name because the workspace takes them from the submodule.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY upstream/opengewerk/packages/platform/domain/package.json upstream/opengewerk/packages/platform/domain/
COPY upstream/opengewerk/packages/platform/server/package.json upstream/opengewerk/packages/platform/server/
COPY upstream/opengewerk/packages/platform/web/package.json upstream/opengewerk/packages/platform/web/
COPY packages/domain/package.json packages/domain/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

COPY . .

# The server with what it depends on, and the interface explicitly: the server
# does not depend on it, and an image without it would start, migrate, answer
# the API and hand out nothing at the root.
RUN pnpm --filter @opengewerk/haustechnik-server... --filter @opengewerk/haustechnik-web run build

# The two checks on the build, where the artefact really is: the budget per
# entry (ADR 0004 in the repository opengewerk) and the words of the
# Handwerkersoftware that must not stand in it (ADR 0001, point 11). The CI
# runs both too; here they also hold for an image somebody builds by hand.
RUN pnpm --filter @opengewerk/haustechnik-web run budget
RUN pnpm --filter @opengewerk/haustechnik-web run words

# The server and its dependencies in a folder of their own, without what only
# exists for building and checking.
RUN pnpm deploy --filter @opengewerk/haustechnik-server --prod /anwendung

# The built interface beside it, under the name the server looks for.
RUN cp -r packages/web/dist /anwendung/interface

FROM node:24-alpine AS runtime

# tini as process 1. Node neither forwards a SIGTERM to child processes nor
# reaps zombies, and both only show up in operation, when an update waits ten
# seconds for a container that is already done.
RUN apk add --no-cache tini

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /anwendung ./

# The mount point of the file store, created here and owned by node. Docker
# copies owner and permissions of an existing directory into a new named
# volume, which is the only way this ends up writable: a volume created from
# nothing belongs to root, and the application does not run as root.
RUN mkdir -p /var/lib/opengewerk-haustechnik/storage \
  && chown node:node /var/lib/opengewerk-haustechnik/storage

# Not as root. An escape from the application then lands on a user with no
# rights, and the application misses nothing: it writes nothing into the image.
USER node

EXPOSE 23800

# The container checks itself, so that an operator has nothing to set up.
# busybox wget rather than node: a Node process every thirty seconds costs
# more memory than the check is worth.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --spider "http://127.0.0.1:${PORT:-23800}/health" || exit 1

# --enable-source-maps so a stack trace points at the line in the TypeScript
# and not at the one in the generated JavaScript.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
