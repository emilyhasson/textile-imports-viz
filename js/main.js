/*** PARAMETERS (STATE) ***/
const state = {
  currentScene: 0,
  animationDone: false,
  data: null,
  countries: null,
  color: d3.scaleOrdinal(d3.schemeTableau10)
};

/*** DIMENSIONS ***/
const margin = {top: 40, right: 20, bottom: 30, left: 60};
let width, height, x, y, svg, clipRect;

/*** SCENE DISPATCHER ***/
function showScene(idx) {
  d3.selectAll('.scene').classed('active', false);
  d3.select('#scene' + idx).classed('active', true);
  state.currentScene = idx;
  if (idx === 1 && !state.animationDone) initChart();
}

/*** SETUP ***/
d3.csv('data/imports.csv', d3.autoType).then(raw => {
  // --- PARSE & NEST DATA ---
  raw.forEach(d => d.date = d3.timeParse('%Y-%m')(`${d.Year}-${d.Month}`));
  // keep Quantity; filter one year (2025) for clarity
  state.data = raw.filter(d => d.Year === 2025);
  state.countries = Array.from(new Set(state.data.map(d => d.Country)));
  state.color.domain(state.countries);

  // Trigger title → chart
  d3.select('#startBtn').on('click', () => showScene(1));
});

/*** INITIALIZE CHART (Scene 1) ***/
function initChart() {
  // size to container
  const bbox = d3.select('#chart').node().getBoundingClientRect();
  width  = bbox.width  - margin.left - margin.right;
  height = bbox.height - margin.top  - margin.bottom;

  svg = d3.select('#chart')
          .attr('width',  bbox.width)
          .attr('height', bbox.height)
          .append('g')
          .attr('transform', `translate(${margin.left},${margin.top})`);

  // SCALES & AXES
  x = d3.scaleTime()
        .domain(d3.extent(state.data, d => d.date))
        .range([0, width]);

  y = d3.scaleLinear()
        .domain([0, d3.max(state.data, d => d.Quantity)]).nice()
        .range([height, 0]);

  svg.append('g').attr('class', 'x-axis')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(d3.timeMonth.every(1)).tickFormat(d3.timeFormat('%b')));

  svg.append('g').attr('class', 'y-axis')
      .call(d3.axisLeft(y).ticks(6, 's').tickSizeOuter(0));

  // CLIP RECT FOR REVEAL ANIMATION
  clipRect = svg.append('clipPath')
      .attr('id', 'clip-reveal')
    .append('rect')
      .attr('width', 0)
      .attr('height', height);

  drawLines();          // add all paths, clipped
  animateReveal();      // martini‑glass “pour”
}

/*** DRAW COUNTRY LINES ***/
function drawLines() {
  const lineGen = d3.line()
      .x(d => x(d.date))
      .y(d => y(d.Quantity))
      .defined(d => !isNaN(d.Quantity));

  // group data by country
  const series = d3.groups(state.data, d => d.Country)
                   .map(([key, values]) => ({key, values: values.sort((a,b)=>d3.ascending(a.date,b.date))}));

  svg.append('g').attr('clip-path', 'url(#clip-reveal)')
    .selectAll('path')
    .data(series)
    .enter().append('path')
        .attr('class', 'country')
        .attr('fill', 'none')              // <- force here
        .attr('stroke', d => state.color(d.key))
        .attr('stroke-width', 1.5)
        .attr('d', d => lineGen(d.values));


    

}

/*** REVEAL ANIMATION (one pass for all lines) ***/
function animateReveal() {
  clipRect.transition()
    .duration(6000)                // length of “linear pour”
    .ease(d3.easeLinear)
    .attr('width', width)
    .on('end', () => {
        state.animationDone = true;
        enableExploration();       // unlock tooltips / legend etc.
    });

  addAnnotations();                // appear during animation
}

/*** ANNOTATIONS (d3-annotation) ***/
function addAnnotations() {
  const biggest = d3.rollup(state.data, v=>d3.sum(v,d=>d.Quantity), d=>d.Country);
  const [topCtry] = Array.from(biggest).sort((a,b)=>d3.descending(a[1],b[1]))[0];

  const latestMonth = d3.max(state.data, d=>d.date);
  const lastPoint = state.data.find(d => d.Country===topCtry && d.date.getTime()===latestMonth.getTime());

  const annotationSpec = [{
    note: { title: `${topCtry}`, label: d3.format(',')(lastPoint.Quantity) + ' SME in Dec' },
    x: x(lastPoint.date),
    y: y(lastPoint.Quantity),
    dy: -40, dx: +20
  }];

  const makeAnnotations = d3.annotation().annotations(annotationSpec);
  svg.append('g').attr('class', 'annotation-group').call(makeAnnotations);
}

/*** INTERACTION AFTER POUR ***/
function enableExploration() {
  // TOOLTIP
  const tip = d3.select('body').append('div')
      .attr('class', 'tooltip')
      .style('position', 'absolute')
      .style('pointer-events', 'none')
      .style('opacity', 0);

  svg.selectAll('path.country')
      .style('cursor', 'pointer')
      .on('mouseover', function(event, d) {
        d3.selectAll('path.country').classed('dimmed', true);
        d3.select(this).classed('dimmed', false).raise();

        tip.style('opacity', 1)
           .html(`<strong>${d.key}</strong>`);
      })
      .on('mousemove', event => {
        tip.style('left', (event.pageX + 10) + 'px')
           .style('top',  (event.pageY - 20) + 'px');
      })
      .on('mouseout', () => {
        d3.selectAll('path.country').classed('dimmed', false);
        tip.style('opacity', 0);
      });

  // LEGEND (mini, clickable)
  const legend = svg.append('g').attr('class', 'legend')
      .attr('transform', `translate(${width - 150},0)`);

  const entries = legend.selectAll('g')
      .data(state.countries)
      .enter().append('g')
        .attr('transform', (d,i) => `translate(0,${i*18})`)
        .style('cursor','pointer')
        .on('click', function(event, country) {
          const active = d3.select(this).classed('active');
          d3.select(this).classed('active', !active);
          // toggle highlight
          svg.selectAll('path.country')
              .classed('dimmed', d => {
                const selfActive = d3.select(`text[label='${d.key}']`).classed('active');
                // dim if any legend is active and this one isn’t
                return !selfActive && legend.selectAll('text.active').size() > 0;
              });
        });

  entries.append('rect')
      .attr('width', 12).attr('height', 12)
      .attr('fill', d => state.color(d));

  entries.append('text')
      .attr('x', 16).attr('y', 10)
      .attr('label', d => d)       // used above
      .text(d => d);
}
