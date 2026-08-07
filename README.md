PORTAL DE DOCUMENTOS EN LÍNEA

No requiere instalar programas.

SERVICIOS:
1. Supabase: usuarios, base de datos y almacenamiento privado.
2. GitHub Pages: publicación de la página.

PASOS:
1. Crear proyecto en Supabase.
2. Abrir SQL Editor y ejecutar supabase_setup.sql.
3. Crear usuario administrador en Authentication > Users.
4. Ejecutar:
   update public.profiles set role='admin' where email='TU_CORREO@EMPRESA.COM';
5. Copiar Project URL y Publishable/anon key en config.js.
6. Crear repositorio público en GitHub.
7. Subir los 7 archivos desde el navegador.
8. Settings > Pages > Deploy from a branch > main / root.
9. Abrir la URL generada por GitHub Pages.
10. Crear usuarios cliente desde Supabase > Authentication > Users.

IMPORTANTE:
- El bucket documents es privado.
- Cada cliente ve únicamente sus documentos.
- El administrador puede ver todos.
- Nunca pongas la Service Role Key en config.js.
