require('dotenv').config();
const express = require('express');
const { createClient } = require('@tursodatabase/serverless/compat');
const app = express();
const PORT = process.env.PORT || 3001;

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});

// 🛡️ REDIRECIONADORES 301
app.use((req, res, next) => {
    if (req.path === '/post.html' && req.query.id) {
        return res.redirect(301, `/produto.html?id=${req.query.id}`);
    }
    const matchAntigo = req.path.match(/\/ofertas\/.*-(\d+)\.html/);
    if (matchAntigo) {
        return res.redirect(301, `/produto.html?id=${matchAntigo[1]}`);
    }
    next();
});

// 🗺️ SITEMAPS
app.get('/sitemap.xml', (req, res) => {
    const totalProdutos = 10092843;
    const totalSitemaps = Math.ceil(totalProdutos / 50000);
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    for (let i = 1; i <= totalSitemaps; i++) {
        xml += `  <sitemap>\n    <loc>https://osachadinhosdashopee.com.br/sitemap-page-${i}.xml</loc>\n    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>\n  </sitemap>\n`;
    }
    xml += '</sitemapindex>';
    res.header('Content-Type', 'application/xml');
    res.send(xml);
});

app.get('/sitemap-page-:page.xml', async (req, res) => {
    const page = parseInt(req.params.page);
    const offset = (page - 1) * 50000;
    try {
        const result = await db.execute({ sql: 'SELECT id FROM produtos LIMIT 50000 OFFSET ?', args: [offset] });
        if (result.rows.length === 0) return res.status(404).send('Sitemap não encontrado');
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
        result.rows.forEach(row => {
            xml += `  <url>\n    <loc>https://osachadinhosdashopee.com.br/produto.html?id=${row.id}</loc>\n  </url>\n`;
        });
        xml += '</urlset>';
        res.header('Content-Type', 'application/xml');
        res.send(xml);
    } catch (e) { res.status(500).send(e.message); }
});

// 🚀 APIS DO CATÁLOGO
app.get('/api/catalogo', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const cat = req.query.cat;
    const q = req.query.q;

    let query = 'SELECT * FROM produtos';
    let params = [];
    let conditions = [];

    if (cat && cat !== 'Todos') { conditions.push('categoria = ?'); params.push(cat); }
    if (q) { conditions.push('titulo LIKE ?'); params.push(`%${q}%`); }
    if (conditions.length > 0) { query += ' WHERE ' + conditions.join(' AND '); }
    
    query += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    try {
        const result = await db.execute({ sql: query, args: params });
        const formatado = result.rows.map(p => ({
            itemId: p.id, titulo: p.titulo, preco: p.preco, imagem: p.imagem, link_afiliado: p.link, categoria: p.categoria, hashtags: p.hashtags
        }));
        res.json(formatado);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rota do Produto com Fallback
app.get('/api/produto/:id', async (req, res) => {
    try {
        const result = await db.execute({ sql: 'SELECT * FROM produtos WHERE id = ?', args: [req.params.id] });
        const p = result.rows[0];
        if (p) {
            res.json({ itemId: p.id, titulo: p.titulo, preco: p.preco, imagem: p.imagem, link_afiliado: p.link, categoria: p.categoria, hashtags: p.hashtags });
        } else {
            const fallback = await db.execute('SELECT * FROM produtos LIMIT 1 OFFSET ' + Math.floor(Math.random() * 1000));
            if (fallback.rows.length > 0) res.json(fallback.rows[0]);
            else res.status(404).json({ error: "Nenhum produto no banco" });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// 👑 ROTA DO ADMIN COM CACHE (A Mágica da Performance)
let cacheStats = { total: null, timestamp: 0 };
app.get('/api/admin/stats', async (req, res) => {
    const agora = Date.now();
    // Se o cache tem menos de 60 segundos, devolve imediatamente
    if (cacheStats.total !== null && (agora - cacheStats.timestamp) < 60000) {
        return res.json({ total: cacheStats.total });
    }
    try {
        const result = await db.execute('SELECT count(*) as total FROM produtos');
        cacheStats.total = result.rows[0].total;
        cacheStats.timestamp = agora;
        res.json({ total: cacheStats.total });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


// --- INÍCIO ROTA INDEXNOW ---
app.get('/api/indexnow', async (req, res) => {
    const key = process.env.INDEXNOW_KEY;
    const url = req.query.url;
    
    if (!key || !url) {
        return res.status(400).json({ error: 'Faltando chave ou URL' });
    }

    try {
        const response = await fetch('https://api.indexnow.org/indexnow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
                host: "osachadinhosdashopee.com.br",
                key: key,
                keyLocation: `https://osachadinhosdashopee.com.br/${key}.txt`,
                urlList: [url]
            })
        });

        if (response.ok) {
            res.json({ success: true, message: 'URL enviada para IndexNow (Bing/Yandex)' });
        } else {
            res.status(500).json({ success: false, message: 'Erro ao enviar' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// --- FIM ROTA INDEXNOW ---

app.listen(PORT, () => console.log(`🚀 API Nuvem rodando na porta ${PORT}!`));
