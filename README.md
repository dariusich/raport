# Rapoarte Traineri Web

MVP web pentru traineri și manageri/contabilă.

## Funcționalități

- `/login` autentificare trainer/admin
- `/trainer` rapoarte active și finalizate
- formular seminar cu listă cursanți permanent vizibilă
- selecție multiplă pentru Absenți, Probleme, Talentați
- `/admin` dashboard manageri
- creare trainer, activare/dezactivare, schimbare parolă
- creare raport pentru trainer cu listă cursanți
- statistici: total seminarii, seminarii pe luni, comision și total plată
- export Excel din raport

## Instalare locală

```bash
npm install
cp .env.example .env
# completează MONGODB_URI
npm run seed
npm run dev
```

Intră pe `http://localhost:3000`.

## Deploy pe Render

1. Creezi repo pe GitHub și urci proiectul.
2. În Render creezi Web Service din repo.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Environment variables:
   - `MONGODB_URI`
   - `SESSION_SECRET`
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
   - `NODE_ENV=production`
6. După primul deploy rulezi o dată comanda `npm run seed` din Render Shell, ca să creezi adminul.

## Observații importante

Acesta este un MVP funcțional. Pentru producție reală recomand:
- resetare parolă prin admin cu audit log;
- rol separat pentru contabilă;
- backup MongoDB Atlas;
- validări suplimentare pe formulare;
- import cursanți din Excel/CSV;
- ștergere/editare seminar de către admin.
