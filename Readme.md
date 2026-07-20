

Generate Collateral 

curl --location 'http://localhost:3000/generate-file' \
--form 'file=@"4ZTwtM_o1/WhatsApp Image 2026-06-12 at 6.58.41 PM.jpeg"' \
--form 'logo=@"/path/to/file"' \
--form 'companyName="Square Yards"' \
--form 'email="contact@squareyards.com"' \
--form 'phone="+91 9876543210"' \
--form 'reraNumber="RAJ/REA/12345"'