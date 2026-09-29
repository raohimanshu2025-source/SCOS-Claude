// Agreed analytics terminology (City OS Section 2 and Section 4, Figure 12) and the analytic
// specification every provider must give (Figure 13): inputs, output, procedure, provenance, visualisation.
export const ONT = {
  ingress: {
    CategoricalValue: ['Categorical'],
    SeriesValue: ['Series', 'Single Stat', 'Time Series'],
    ArrayLikeValue: ['nd-Array'],
    MapLikeValue: ['DA graph', 'Adjacency Matrix', 'Vector Set', 'Hash Map'],
    StatisticalDistributionValue: ['Probability Distribution'],
  },
  process: ['RequiresDataSource', 'RequiresAdditionalDataSource', 'RequiresDataPeriodicity', 'ProcessPeriodicity', 'OutputDataType'],
  egress: ['Series Forecast', 'Series', 'Graph', 'Probability Distribution', 'Table', 'Vectors', 'MeshGrid', 'Image', 'Single Stat'],
  viz: {
    CategoricalVisualization: ['Pie', 'Rose'],
    SeriesVisualization: ['Bar', 'Line', 'Scatter'],
    TabularVisualization: ['Table'],
    CalendarVisualization: ['Calendar Heatmap'],
    MapVisualization: ['Map Raster', 'Map Vectors'],
  },
  domains: ['Air Quality', 'Intelligent Transit', 'Solid Waste', 'Flood', 'Weather', 'Citizen Grievance'], // City OS Section 3
};
export const ING_ALL = Object.values(ONT.ingress).flat();
export const VIZ_ALL = Object.values(ONT.viz).flat();

// Checks the parts of a specification that the ontology governs. Returns a list of problems.
export function checkSpec(s) {
  const e = [];
  if (!/^\/[a-z]+\/[A-Za-z]+$/.test(s.path || '')) e.push('path must look like /domain/apiName');
  if (!ONT.domains.includes(s.domain)) e.push('domain must be one of ' + ONT.domains.join(', '));
  if (!s.name) e.push('name required');
  if (!Array.isArray(s.inputs) || !s.inputs.length) e.push('at least one input (RequiresDataSource) is required');
  for (const i of s.inputs || []) {
    if (!ING_ALL.includes(i.type)) e.push(`input type "${i.type}" is not an ingress type in the agreed ontology (Figure 12)`);
    if (!['RequiresDataSource', 'RequiresAdditionalDataSource'].includes(i.role)) e.push(`input role "${i.role}" must be RequiresDataSource or RequiresAdditionalDataSource`);
    if (!i.group || !i.attr) e.push('each input names a resource server group and an attribute');
  }
  if (!(s.inputs || []).some(i => i.role === 'RequiresDataSource')) e.push('one input must be the RequiresDataSource');
  if (!ONT.egress.includes(s.out)) e.push(`output "${s.out}" is not an egress type (Figure 12)`);
  if (!VIZ_ALL.includes(s.viz)) e.push(`visualisation "${s.viz}" is not in the ontology (Figure 12)`);
  if (!s.procedure) e.push('procedure description required (Figure 13)');
  if (!s.provenance) e.push('provenance required (Figure 13)');
  if (!(Number(s.period) >= 1)) e.push('ProcessPeriodicity (period, minutes) must be at least 1');
  if (!s.dataPeriodicity) e.push('RequiresDataPeriodicity required');
  return e;
}
