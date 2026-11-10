import {defineConfig} from 'vite';
export default defineConfig({
 server:{host:'localhost',port:5173,strictPort:true,headers:{'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}},
 build:{outDir:'dist',emptyOutDir:true},
});
