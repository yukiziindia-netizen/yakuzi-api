const m = { options: [[]] }; const options = Array.isArray(m.options) ? m.options.filter(o => o && typeof o === 'object' && !Array.isArray(o) && o.name) : []; console.log(options);
