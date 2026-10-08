// Bundle the complete offline app into one portable HTML file.
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname,file),'utf8');
const dataUrl = file => 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname,file)).toString('base64');
let html = read('index.html');
const css = read('styles.css').replace("url('assets/paper-atlas.png')", `url('${dataUrl('assets/paper-atlas.png')}')`);
html = html.replace('<link rel="stylesheet" href="styles.css">', () => '<style>' + css + '</style>');
html = html.replace(/<script defer src="([^"]+)"><\/script>/g, (_,file) => '<script>' + read(file).replace(/<\/script/gi,'<\\/script') + '</script>');
// Bundled scripts execute after the document exists, in the same order as defer.
const scripts = [];
html = html.replace(/<script>[\s\S]*?<\/script>/g, script => { scripts.push(script); return ''; });
html = html.replace('</body>', () => scripts.join('\n') + '\n</body>');
html = html.replace(/(<img\b[^>]*?\s+src\s*=\s*)(["'])(assets\/[^"']+\.png)\2/gi, (_,prefix,quote,file) => prefix + quote + dataUrl(file) + quote);
fs.writeFileSync(path.join(__dirname,'주사위작곡.html'),html);
console.log('Portable offline app: 주사위작곡.html (' + Math.round(Buffer.byteLength(html)/1024/1024*10)/10 + ' MB)');
