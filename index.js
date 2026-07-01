const fastify = require('fastify')({ logger: false }); // Oprim logger-ul nativ în teste pentru performanță maximă
const Redis = require('ioredis');
const { Pool } = require('pg');

// Conectare la Redis
const redis = new Redis({
    host: 'localhost',
    port: 6379
});

// Conectare la PostgreSQL
const pgPool = new Pool({
    user: 'admin',
    host: 'localhost',
    database: 'ticket_db',
    password: 'supersecretpassword',
    port: 5433,
    max: 50 // Numărul maxim de conexiuni concurente în pool-ul SQL
});

// Inițializare Bază de Date (Simulăm un concert)
async function initDB() {
    await pgPool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      title VARCHAR(100),
      available_tickets INT
    );
  `);

    // Inserăm un concert de test dacă nu există deja
    const res = await pgPool.query('SELECT * FROM events WHERE id = 1');
    if (res.rowCount === 0) {
        await pgPool.query("INSERT INTO events (id, title, available_tickets) VALUES (1, 'Concert Rock VIP', 1000)");
    }
}

async function rateLimiter(request, reply) {
    const ip = request.ip; // Identificăm utilizatorul după IP
    const key = `rate:limit:${ip}`;

    const limit = 20; // Maxim 20 de cereri...
    const windowSeconds = 10; // ...la fiecare 10 secunde

    // INCR mărește valoarea cu 1 atomic în Redis. Dacă cheia nu există, o creează cu valoarea 1.
    const currentRequests = await redis.incr(key);

    // Dacă e prima cerere din această fereastră de timp, îi setăm expirarea (TTL)
    if (currentRequests === 1) {
        await redis.expire(key, windowSeconds);
    }

    // Dacă utilizatorul a depășit limita, blocăm request-ul instant
    if (currentRequests > limit) {
        reply.status(429).send({
            error: 'Too Many Requests',
            message: 'Te rugăm să aștepți câteva secunde înainte de a încerca din nou.'
        });
        return reply; // Oprește execuția rutei
    }
}

// Pornire server
const start = async () => {
    try {
        await initDB();
        await fastify.listen({ port: 3000 });
        console.log('🚀 Serverul rulează pe http://localhost:3000');
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};
// RUTA UN-OPTIMIZED: Lovește baza de date la fiecare request
// RUTA UN-OPTIMIZED îmbunătățită pentru test: adăugăm un delay artificial în SQL
fastify.get('/unoptimized/ticket', async (request, reply) => {
    try {
        // pg_sleep(0.05) simulează o latență reală de database de 50ms (căutare pe disc, tabele mari, etc.)
        const result = await pgPool.query('SELECT *, pg_sleep(0.05) FROM events WHERE id = 1');

        return result.rows[0];
    } catch (error) {
        reply.status(500).send({ error: 'Database error' });
    }
});

// RUTA OPTIMIZED: Folosește Rate Limiter și Redis Cache
fastify.get('/optimized/ticket', { preHandler: rateLimiter }, async (request, reply) => {
    const cacheKey = 'ticket:1';

    try {
        // 1. Încercăm să luăm datele din Redis RAM (Cache Hit?)
        const cachedData = await redis.get(cacheKey);

        if (cachedData) {
            // Dacă am găsit în cache, convertim din string înapoi în JSON și returnăm instant
            return JSON.parse(cachedData);
        }

        // 2. Cache Miss: Dacă nu e în Redis, mergem în PostgreSQL
        console.log('⚠️ Cache Miss! Mergem la baza de date...');
        const result = await pgPool.query('SELECT * FROM events WHERE id = 1');
        const ticketData = result.rows[0];

        // 3. Salvăm datele în Redis pentru request-urile viitoare, cu un TTL de 30 secunde
        await redis.set(cacheKey, JSON.stringify(ticketData), 'EX', 30);

        return ticketData;
    } catch (error) {
        reply.status(500).send({ error: 'Server error' });
    }
});

start();