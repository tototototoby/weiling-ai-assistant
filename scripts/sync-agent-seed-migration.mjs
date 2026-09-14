import { readFile, writeFile } from 'node:fs/promises';

// Keep the historical filename stable for databases that already recorded this
// migration. The contents are updated to the current Weiling brand below.
const migrationPath = new URL('../packages/db/src/migrations/0031_welink_brand_copy.sql', import.meta.url);
const agentsPath = new URL('../resources/agent/global/AGENTS.md', import.meta.url);
const soulPath = new URL('../resources/agent/global/SOUL.md', import.meta.url);
const marker = '-- Current open-source agent seeds';

function quoteSql(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

const [currentMigration, agentsRaw, soulRaw] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(agentsPath, 'utf8'),
  readFile(soulPath, 'utf8'),
]);
const prefix = currentMigration.includes(marker)
  ? currentMigration.slice(0, currentMigration.indexOf(marker)).trimEnd()
  : currentMigration.trimEnd();
const agents = agentsRaw.trimEnd();
const soul = soulRaw.trimEnd();

const seedSql = `--> statement-breakpoint
${marker}; update only recognizable built-in documents and preserve administrator-authored custom copy.
UPDATE \`global_agent_configs\` SET
\t\`agents_markdown\` = ${quoteSql(agents)},
\t\`soul_markdown\` = ${quoteSql(soul)},
\t\`revision\` = \`revision\` + 1,
\t\`updated_at\` = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE \`id\` = 'global'
\tAND (\`agents_markdown\` LIKE '# 高新小灵全局工作规则%'
\t\tOR \`agents_markdown\` LIKE '# 微Link全局工作规则%'
\t\tOR \`soul_markdown\` LIKE '# 高新小灵的气质%'
\t\tOR \`soul_markdown\` LIKE '# 微Link的气质%')
\tAND (\`agents_markdown\` <> ${quoteSql(agents)} OR \`soul_markdown\` <> ${quoteSql(soul)});
`;

await writeFile(migrationPath, `${prefix}\n\n${seedSql}`, 'utf8');
process.stdout.write('Synchronized open-source AGENTS.md and SOUL.md into migration 0031.\n');
