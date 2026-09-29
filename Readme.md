

Generate Collateral 

Run the server under PM2:

```sh
npm install
npm run pm2:start
npm run pm2:status
npm run pm2:logs
```

Use `npm run pm2:restart`, `npm run pm2:stop`, or `npm run pm2:delete` to manage the process. PM2 reads the `PORT` environment variable; the server defaults to port 4001.

curl --location 'http://localhost:3000/generate-file' \
--form 'file=@"4ZTwtM_o1/WhatsApp Image 2026-06-12 at 6.58.41 PM.jpeg"' \
--form 'logo=@"/path/to/file"' \
--form 'companyName="Square Yards"' \
--form 'email="contact@squareyards.com"' \
--form 'phone="+91 9876543210"' \
--form 'reraNumber="RAJ/REA/12345"'