import os, shutil, json
H=os.path.dirname(os.path.abspath(__file__))+'/'
core=open(H+'core.js',encoding='utf-8').read()
app=open(H+'app.js',encoding='utf-8').read()
css=open(H+'style.css',encoding='utf-8').read()
XLSX='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
def page(config_tag, extra_head=''):
    return '''<!doctype html>
<html lang="ru" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Деньги">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Kubcrafter: деньги</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap">
'''+extra_head+'''<style>
'''+css+'''
</style>
</head>
<body>
<div id="root"></div>
'''+config_tag+'''
<script>
'''+core+'''
</script>
<script src="'''+XLSX+'''"></script>
<script>
'''+app+'''
</script>
</body>
</html>
'''
os.makedirs(H+'dist/deploy',exist_ok=True)
open(H+'dist/artifact.html','w',encoding='utf-8').write(page('<script>window.KC_CONFIG={allowProd:false,sw:false};</script>'))
open(H+'dist/deploy/index.html','w',encoding='utf-8').write(page('<script src="config.js"></script>','<link rel="manifest" href="manifest.webmanifest">\n<link rel="apple-touch-icon" href="icon-180.png">\n'))
print(len(page('')))

# в репозитории (рядом лежит firebase.json) готовый index.html копируется в корень, откуда его отдаёт GitHub Pages
root=os.path.dirname(os.path.dirname(H.rstrip('/')))
if os.path.exists(os.path.join(os.path.dirname(H.rstrip('/')),'firebase.json')):
    shutil.copy(H+'dist/deploy/index.html', os.path.join(os.path.dirname(H.rstrip('/')),'index.html'))
    print('index.html обновлён в корне репозитория')
