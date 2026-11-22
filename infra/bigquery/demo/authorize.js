#!/usr/bin/env node
/**
 * Learning Loop T16: lets the dataset `expelly_demo` read the views in `expelly_learning`.
 *
 * BigQuery calls this an "authorized dataset": a dataset's access list can name another dataset, and
 * every VIEW in that other dataset may then read the first one. Result: someone who can read ONLY
 * `expelly_demo` (a viewer of the dashboard, a Looker service account) can query the demo views, and
 * nothing else in `expelly_learning`.
 *
 * Used by apply-demo.sh:
 *   bq show --format=prettyjson P:expelly_learning | node authorize.js P expelly_demo > acl.json
 * Idempotent: running it twice adds the entry once.
 */
'use strict';

function addAuthorizedDataset(dataset, projectId, datasetId) {
  const access = Array.isArray(dataset.access) ? dataset.access.slice() : [];
  const already = access.some(
    (a) =>
      a.dataset &&
      a.dataset.dataset &&
      a.dataset.dataset.projectId === projectId &&
      a.dataset.dataset.datasetId === datasetId,
  );
  if (!already) {
    access.push({
      dataset: { dataset: { projectId, datasetId }, targetTypes: ['VIEWS'] },
    });
  }
  return { ...dataset, access };
}

module.exports = { addAuthorizedDataset };

if (require.main === module) {
  const [project, demo] = process.argv.slice(2);
  if (!project || !demo) {
    console.error('usage: authorize.js <project> <demo dataset>  < dataset.json');
    process.exit(2);
  }
  let raw = '';
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    // bq may print a banner before the JSON on some versions: start at the first brace
    const json = JSON.parse(raw.slice(raw.indexOf('{')));
    process.stdout.write(
      JSON.stringify(addAuthorizedDataset(json, project, demo), null, 2) + '\n',
    );
  });
}
