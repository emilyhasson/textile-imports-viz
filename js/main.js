/*
  main.js — Minimal narrative viz to show rising/declining countries.
  Structure: Interactive slideshow (martini-ish): 4 scenes.
  Scenes:
    0 Intro card
    1 Bar chart: % change (first vs last month) — highlights risers & decliners
    2 Multi-line chart for top risers/decliners
    3 Explore: pick any country, simple line + tooltip
*/

// ---------------------- Global State ----------------------
const state = {
  sceneIndex: 0,
  metric: 'Quantity',              // 'Quantity' or 'Value'
  selectedCountry: null,
  topN: 5,                          // top risers & decliners count
  data: [],                         // raw rows
  series: [],                       // [{country, values:[{date, Quantity, Value}]}]
  changes: []                       // [{country, first, last, changeAbs, changePct}]
};

const scenes = [introScene, changeBarsScene, linesScene, exploreScene];

// dims
const margin = {top: 30, right: 20, bottom: 40, left: 60};
const width = 880;
const height = 500;

// tooltip div
const tooltip = d3.select('#tooltip');

// ---------------------- Load & Prep -----------------------
d3.csv('data/imports.csv', d3.autoType).then(raw => {
  // Expect columns: Country, Year, Month, Quantity, Value (plus others ignored)
  raw.forEach(d => d.date = new Date(d.Year, d.Month - 1, 1));

  state.data = raw.filter(d => d.Country && d.Quantity != null && d.Value != null);

  // Build series by country
  const byCountry = d3.rollups(state.data,
    v => v,
    d => d.Country
  );

  state.series = byCountry.map(([country, rows]) => {
    const values = d3.rollups(rows,
      vv => ({
        Quantity: d3.sum(vv, d => d.Quantity),
        Value: d3.sum(vv, d => d.Value)
      }),
      d => d.date
    ).map(([date, m]) => ({ date, Quantity: m.Quantity, Value: m.Value }))
     .sort((a,b) => a.date - b.date);
    return { country, values };
  });

  // Compute change from first to last available month for each country
  state.changes = state.series.map(s => {
    const first = s.values[0]?.[state.metric];
    const last  = s.values[s.values.length-1]?.[state.metric];
    const changeAbs = last - first;
    const changePct = first ? changeAbs / first : 0;
    return { country: s.country, first, last, changeAbs, changePct };
  });

  // Default country = biggest riser (by %)
  state.selectedCountry = d3.greatest(state.changes, d => d.changePct)?.country || state.series[0].country;

  initControls();
  render();
});

// ---------------------- Controls --------------------------
function initControls(){
  d3.select('#next').on('click', () => {
    state.sceneIndex = Math.min(state.sceneIndex + 1, scenes.length - 1);
    render();
  });
  d3.select('#prev').on('click', () => {
    state.sceneIndex = Math.max(state.sceneIndex - 1, 0);
    render();
  });

  d3.selectAll('input[name="metric"]').on('change', (event) => {
    state.metric = event.target.value;
    // recompute change metrics when metric changes
    state.changes.forEach(c => {
      const s = state.series.find(s => s.country === c.country);
      const first = s.values[0]?.[state.metric];
      const last  = s.values[s.values.length-1]?.[state.metric];
      c.first = first; c.last = last; c.changeAbs = last - first; c.changePct = first ? (c.changeAbs/first) : 0;
    });
    render();
  });

  // Country dropdown (explore scene only)
  const countryList = state.series.map(d => d.country).sort(d3.ascending);
  const select = d3.select('#countrySelect')
    .on('change', (event) => {
      state.selectedCountry = event.target.value;
      render();
    });
  select.selectAll('option')
    .data(countryList)
    .join('option')
    .attr('value', d => d)
    .text(d => d);
}

function updateControlsVisibility(){
  // metric always visible
  // country dropdown only on scene 3
  d3.select('#country-control').classed('hidden', state.sceneIndex !== 3);
  // prev/next disabled at ends
  d3.select('#prev').attr('disabled', state.sceneIndex === 0 ? true : null);
  d3.select('#next').attr('disabled', state.sceneIndex === scenes.length-1 ? true : null);
}

// ---------------------- Render Switch ---------------------
function render(){
  updateControlsVisibility();
  d3.select('#vis').html('');
  d3.select('#scene-text').html('');
  scenes[state.sceneIndex]();
}

// ---------------------- Scene 0 ---------------------------
function introScene(){
  d3.select('#scene-text').html(
    `<strong>Where do America’s clothes come from?</strong>\n` +
    `This short slideshow highlights which supplier countries are rising or declining in US apparel imports. Click <em>Next</em> to begin.`
  );

  const svg = setupSVG();
  // Just a quiet title card box
  svg.append('text')
    .attr('x', width/2)
    .attr('y', height/2 - 20)
    .attr('text-anchor', 'middle')
    .attr('font-size', 28)
    .attr('font-weight', 600)
    .text('US Apparel Imports');

  svg.append('text')
    .attr('x', width/2)
    .attr('y', height/2 + 15)
    .attr('text-anchor', 'middle')
    .attr('font-size', 18)
    .text('Risers & Decliners by Country');
}

// ---------------------- Scene 1 ---------------------------
function changeBarsScene(){
  d3.select('#scene-text').html(
    `From the first month in the data to the most recent, some countries grew, others shrank. ` +
    `Bars show <strong>absolute change</strong> in ${state.metric.toLowerCase()} (Δ = last − first). Green = rising, orange = declining.`
  );

  const svg = setupSVG();

  // Use absolute change to avoid percent blow‑ups from tiny baselines
  const changesAll = state.changes.filter(d => isFinite(d.changeAbs));

  // (Optional) filter out countries with a tiny starting value so bars are comparable
  const threshold = d3.quantile(changesAll.map(d => d.first).filter(x => x > 0), 0.2); // 20th percentile
  const filtered = changesAll.filter(d => d.first >= threshold);

  const topRisers = d3.sort(filtered, d => -d.changeAbs).slice(0, state.topN);
  const topDecliners = d3.sort(filtered, d => d.changeAbs).slice(0, state.topN);
  const view = [...topRisers, ...topDecliners];

  const x = d3.scaleLinear()
    .domain([d3.min(view, d => d.changeAbs), d3.max(view, d => d.changeAbs)])
    .nice()
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(view.map(d => d.country))
    .range([margin.top, height - margin.bottom])
    .padding(0.15);

  const xAxis = g => g
    .attr('transform', `translate(0,${margin.top})`)
    .call(d3.axisTop(x).tickFormat(d3.format('+.2s')))
    .call(g => g.select('.domain').remove());
    
  const yAxis = g => g
  .attr('transform', `translate(${margin.left},0)`)
  .call(d3.axisLeft(y))
  .call(g => g.select('.domain').remove());


  svg.append('g').attr('class','axis').call(xAxis);
  svg.append('g').attr('class','axis').call(yAxis);

  svg.selectAll('.bar')
    .data(view)
    .join('rect')
    .attr('class', d => `bar ${d.changeAbs >= 0 ? 'rise' : 'decline'}`)
    .attr('x', d => x(Math.min(0, d.changeAbs)))
    .attr('y', d => y(d.country))
    .attr('height', y.bandwidth())
    .attr('width', d => Math.abs(x(d.changeAbs) - x(0)))
    .on('mousemove', (event, d) => {
      showTooltip(event, `${d.country}<br>Δ ${fmtNum(d.changeAbs)} (${fmtNum(d.first)} → ${fmtNum(d.last)})`);
    })
    .on('mouseleave', hideTooltip);

  // zero line
  svg.append('line')
    .attr('x1', x(0))
    .attr('x2', x(0))
    .attr('y1', margin.top)
    .attr('y2', height - margin.bottom)
    .attr('stroke', '#666')
    .attr('stroke-dasharray', '3,3');

  // annotations: biggest riser & decliner
  const best = topRisers[0];
  const worst = topDecliners[0];
  const annos = [];
  if(best){
    annos.push({
      title: 'Biggest riser',
      label: `${best.country} up ${fmtNum(best.changeAbs)}`,
      x: x(best.changeAbs),
      y: y(best.country) + y.bandwidth()/2,
      dx: 40, dy: -30
    });
  }
  if(worst){
    annos.push({
      title: 'Biggest decliner',
      label: `${worst.country} down ${fmtNum(worst.changeAbs)}`,
      x: x(worst.changeAbs),
      y: y(worst.country) + y.bandwidth()/2,
      dx: -120, dy: 30
    });
  }
  addAnnotations(svg, annos);
}

// ---------------------- Scene 2 ---------------------------
function linesScene(){
  d3.select('#scene-text').html(
    `How did those countries change over time? Lines show monthly ${state.metric.toLowerCase()} for the top ${state.topN} risers and decliners.`
  );

  const svg = setupSVG();

  const changes = state.changes.filter(d => isFinite(d.changePct));
  const topRisers = d3.sort(changes, d => -d.changePct).slice(0, state.topN).map(d=>d.country);
  const topDecliners = d3.sort(changes, d => d.changePct).slice(0, state.topN).map(d=>d.country);
  const focusCountries = new Set([...topRisers, ...topDecliners]);

  const series = state.series.filter(s => focusCountries.has(s.country));

  const metric = state.metric;
  const allDates = d3.union(...series.map(s => s.values.map(v => v.date)));
  const x = d3.scaleTime()
    .domain(d3.extent(allDates))
    .range([margin.left, width - margin.right]);

  const y = d3.scaleLinear()
    .domain([0, d3.max(series, s => d3.max(s.values, v => v[metric]))]).nice()
    .range([height - margin.bottom, margin.top]);

  const color = d3.scaleOrdinal()
    .domain(series.map(s => s.country))
    .range(d3.schemeTableau10);

  const line = d3.line()
    .x(d => x(d.date))
    .y(d => y(d[metric]));

  // axes
  svg.append('g')
    .attr('class','axis')
    .attr('transform', `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(width/90).tickSizeOuter(0));

  svg.append('g')
    .attr('class','axis')
    .attr('transform', `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(6).tickFormat(d3.format('.2s')));

  // lines
  const gLines = svg.append('g');
  gLines.selectAll('.line')
    .data(series)
    .join('path')
    .attr('class', 'line')
    .attr('stroke', d => color(d.country))
    .attr('d', d => line(d.values))
    .on('mousemove', (event, d) => {
      const [mx] = d3.pointer(event);
      const date = x.invert(mx);
      const bisect = d3.bisector(v => v.date).center;
      const i = bisect(d.values, date);
      const v = d.values[i];
      showTooltip(event, `<strong>${d.country}</strong><br>${fmtDate(v.date)}<br>${fmtNum(v[metric])}`);
    })
    .on('mouseleave', hideTooltip);

  // Annotations: highlight the single top riser & decliner final points
  const topR = topRisers[0];
  const topD = topDecliners[0];
  const getLastPoint = (country) => {
    const s = series.find(s => s.country === country);
    return s ? s.values[s.values.length-1] : null;
  };
  const annos = [];
  if(topR){
    const p = getLastPoint(topR);
    if(p) annos.push({ title: 'Riser', label: topR, x: x(p.date), y: y(p[metric]), dx: 20, dy: -40 });
  }
  if(topD){
    const p = getLastPoint(topD);
    if(p) annos.push({ title: 'Decliner', label: topD, x: x(p.date), y: y(p[metric]), dx: -40, dy: 30 });
  }
  addAnnotations(svg, annos);
}

// ---------------------- Scene 3 ---------------------------
function exploreScene(){
  d3.select('#scene-text').html(
    `Explore any country. Hover to see exact values. Change metric with the radio buttons.`
  );

  const svg = setupSVG();
  const metric = state.metric;
  const s = state.series.find(d => d.country === state.selectedCountry) || state.series[0];

  const x = d3.scaleTime()
    .domain(d3.extent(s.values, d => d.date))
    .range([margin.left, width - margin.right]);

  const y = d3.scaleLinear()
    .domain([0, d3.max(s.values, d => d[metric])]).nice()
    .range([height - margin.bottom, margin.top]);

  const line = d3.line().x(d => x(d.date)).y(d => y(d[metric]));

  // axes
  svg.append('g')
    .attr('class','axis')
    .attr('transform', `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(width/90).tickSizeOuter(0));

  svg.append('g')
    .attr('class','axis')
    .attr('transform', `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(6).tickFormat(d3.format('.2s')));

  // line
  svg.append('path')
    .datum(s.values)
    .attr('class','line')
    .attr('stroke', 'var(--accent)')
    .attr('d', line);

  // circles for hover
  svg.selectAll('circle')
    .data(s.values)
    .join('circle')
    .attr('cx', d => x(d.date))
    .attr('cy', d => y(d[metric]))
    .attr('r', 3)
    .attr('fill', 'var(--accent)')
    .on('mousemove', (event, d) => showTooltip(event, `${fmtDate(d.date)}<br>${fmtNum(d[metric])}`))
    .on('mouseleave', hideTooltip);

  // simple title annotation
  addAnnotations(svg, [{
    title: state.selectedCountry,
    label: `Trend in ${metric.toLowerCase()}`,
    x: x(s.values[Math.floor(s.values.length/3)].date),
    y: y(s.values[Math.floor(s.values.length/3)][metric]),
    dx: 20, dy: -20
  }]);
}

// ---------------------- Helpers ---------------------------
function setupSVG(){
  return d3.select('#vis')
    .append('svg')
    .attr('width', width)
    .attr('height', height);
}

function addAnnotations(svg, list){
  if(!list || !list.length) return;
  const annos = list.map(d => ({
    type: d3.annotationCalloutElbow,
    note: { title: d.title, label: d.label },
    x: d.x, y: d.y, dx: d.dx, dy: d.dy
  }));
  const make = d3.annotation().annotations(annos);
  svg.append('g').attr('class','annotation-group').call(make);
}

function fmtPct(x){ return d3.format("+.0%")(x); }
function fmtNum(x){ return d3.format(".2s")(x); }
function fmtDate(d){ return d3.timeFormat('%b %Y')(d); }

function showTooltip(event, html){
  tooltip.html(html)
    .style('left', (event.pageX + 12) + 'px')
    .style('top',  (event.pageY + 12) + 'px')
    .classed('hidden', false);
}
function hideTooltip(){ tooltip.classed('hidden', true); }