import http from 'k6/http';
import { sleep } from 'k6';

export const options = {
    // Simulăm 200 de utilizatori simultani care fac request-uri constant timp de 15 secunde
    vus: 200,
    duration: '15s',
};

export default function () {
    // Schimbă URL-ul în funcție de ce testezi:
    // Pentru testul 1 (Ne-optimizat): http://localhost:3000/unoptimized/ticket
    // Pentru testul 2 (Optimizat): http://localhost:3000/optimized/ticket
    http.get('http://localhost:3000/unoptimized/ticket');

    sleep(0.1); // Fiecare utilizator virtual așteaptă 100ms între request-uri
}