#!/bin/bash
set -e

WORKFLOW_OUTPUT="/private/tmp/claude-501/-Users-cambrose-Documents/8bd5b76e-2eab-4a7a-8533-ce34f854b70e/tasks/wir2qhuuy.output"

echo "Extracting workflow results and building repository..."

# Extract and write CLI files
for i in {0..7}; do
  PATH_VAL=$(jq -r ".result.cliFiles[$i].path" "$WORKFLOW_OUTPUT" 2>/dev/null)
  if [ "$PATH_VAL" != "null" ]; then
    echo "Creating $PATH_VAL"
    mkdir -p "$(dirname "$PATH_VAL")"
    jq -r ".result.cliFiles[$i].content" "$WORKFLOW_OUTPUT" > "$PATH_VAL"
  fi
done

# Extract buildpack files
for field in detect compile release buildpack-readme; do
  if [ "$field" = "buildpack-readme" ]; then
    TARGET="buildpack/README.md"
  else
    TARGET="buildpack/bin/$field"
  fi
  
  CONTENT=$(jq -r ".result.buildpackFiles[] | select(.content != null) | select(. | tostring | contains(\"$field\")) | .content" "$WORKFLOW_OUTPUT" 2>/dev/null | head -1)
  
  if [ -n "$CONTENT" ] && [ "$CONTENT" != "null" ]; then
    echo "Creating $TARGET"
    mkdir -p "$(dirname "$TARGET")"
    echo "$CONTENT" > "$TARGET"
    [ "$field" != "buildpack-readme" ] && chmod +x "$TARGET"
  fi
done

# Extract repository files
jq -r '.result.repoFiles[0].content' "$WORKFLOW_OUTPUT" > README.md 2>/dev/null || echo "README extraction failed"
jq -r '.result.repoFiles[1].content' "$WORKFLOW_OUTPUT" > package.json 2>/dev/null || echo "package.json extraction failed"  
jq -r '.result.repoFiles[3].content' "$WORKFLOW_OUTPUT" > CONTRIBUTING.md 2>/dev/null || echo "CONTRIBUTING extraction failed"
jq -r '.result.repoFiles[4].content' "$WORKFLOW_OUTPUT" > tsconfig.json 2>/dev/null || echo "tsconfig extraction failed"
jq -r '.result.repoFiles[5].content' "$WORKFLOW_OUTPUT" > .gitignore 2>/dev/null || echo ".gitignore extraction failed"

# Extract types file
TYPE_CONTENT=$(jq -r '.result.repoFiles[2].content' "$WORKFLOW_OUTPUT" 2>/dev/null)
if [ -n "$TYPE_CONTENT" ] && [ "$TYPE_CONTENT" != "null" ]; then
  echo "$TYPE_CONTENT" > src/types/experiment.ts
fi

# Extract test files
jq -r '.result.testFiles[0].content' "$WORKFLOW_OUTPUT" > .github/workflows/test.yml 2>/dev/null || echo "GH Actions extraction failed"
jq -r '.result.testFiles[2].content' "$WORKFLOW_OUTPUT" > test/integration.sh 2>/dev/null || echo "Integration test extraction failed"
chmod +x test/integration.sh 2>/dev/null

echo "Repository structure created!"
ls -la
