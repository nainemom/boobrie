#!/bin/sh
set -eu

npx changelogen --clean --release --noAuthors --no-commit --no-tag --output CHANGELOG.md
npm i --package-lock-only # hacky way to push package.json version into lock file
npm run lint:fix
git add --all
VERSION=$(node -p "require('./package.json').version")
git commit -m "chore(release): v$VERSION"
git tag "v$VERSION"