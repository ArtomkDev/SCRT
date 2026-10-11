# Безкоштовний проксі YouTube на Oracle

Бот і веб залишаються на поточному хостингу. Oracle VM надає окреме підключення для пошуку та аудіо YouTube. Цю інструкцію підготовлено 2026-10-11; акаунт, VM і проксі ще не створено. Доступ конкретного IP до YouTube перевіряється до підключення Railway.

## 1. Акаунт і сервер

Зареєструй [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/). Залиш акаунт на безкоштовному тарифі. [Перевірка картки](https://www.oracle.com/cloud/free/faq/) може тимчасово заблокувати суму; це окремо від щомісячної оплати. Обирай ресурси **Always Free**, а не ресурси за тимчасові $300 кредитів.

У своєму **Home region** відкрий **Compute → Instances → Create instance**. Якщо потрібна мережа, створи VCN через **Create VCN with Internet Connectivity**. [Офіційна інструкція створення VM](https://docs.oracle.com/en-us/iaas/Content/Compute/tutorials/first-linux-instance/overview.htm).

| Поле | Значення |
| --- | --- |
| Name | `scrt-youtube-proxy` |
| Image | Ubuntu 24.04 LTS, позначена Always Free eligible; не Minimal |
| Shape | `VM.Standard.A1.Flex` |
| OCPUs / RAM | 1 OCPU / 2 GB |
| Boot volume | 50 GB, стандартні параметри продуктивності |
| Network | Public subnet, Internet Gateway, public IPv4; IPv6 для цієї схеми не налаштовуй |
| SSH | Створи пару ключів і збережи приватний ключ у себе |

[Поточні ліміти Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) включають загалом 2 OCPU / 12 GB A1, 200 GB дисків і 10 TB вихідного трафіку на місяць. Враховуй також інші ресурси цього акаунта та перевір позначення/ліміти у консолі перед створенням. Якщо A1 недоступний, для самого проксі підійде Always Free `VM.Standard.E2.1.Micro` з 1 GB RAM. Помилка **out of host capacity** означає відсутність вільних серверів: спробуй інший доступний availability domain у своєму Home region або зачекай. Для нульового бюджету не переходь на платний тариф заради доступності.

На цьому етапі відкрий inbound TCP **22 тільки для свого публічного IP /32** у Security List або NSG. Збережи публічний IPv4 VM. Підключайся з PowerShell, підставивши свій шлях до ключа та IP:

```powershell
ssh -i 'C:\path\oracle.key' ubuntu@PUBLIC_IP
```

## 2. Перевірка YouTube до встановлення проксі

Далі команди `bash` виконуються **на новій Oracle VM**, а команди `powershell` — у локальному репозиторії SCRT. На VM не потрібні токен Discord, Firebase, cookies або запуск другого бота.

На VM встанови Node 22 із [Snap Store](https://snapcraft.io/node) та створи каталог для перевірки:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl snapd
sudo snap install node --classic --channel=22
node --version
mkdir -p "$HOME/scrt-probe/scripts"
```

Версія Node має бути щонайменше 22.12. У локальному PowerShell скопіюй **лише наявний скрипт встановлення екстрактора**, який перевіряє SHA-256 офіційної збірки:

```powershell
scp -i 'C:\path\oracle.key' .\scripts\setup-media.mjs ubuntu@PUBLIC_IP:scrt-probe/scripts/setup-media.mjs
```

Повернися до SSH на VM. Ця перевірка завантажує короткі фрагменти двох проблемних треків у `/dev/null`; аудіофайли не зберігаються:

```bash
cd "$HOME/scrt-probe"
node scripts/setup-media.mjs
for scrt_video_id in JB4RmAsA8K4 3NqT19zwTmo; do
  timeout 35s apps/bot/.media-tools/yt-dlp \
    --ignore-config --no-cache-dir --no-plugin-dirs --no-playlist \
    --force-ipv4 --proxy '' --js-runtimes "node:$(command -v node)" \
    --socket-timeout 8 --retries 0 --extractor-retries 0 \
    -f 'bestaudio[protocol=https]/bestaudio[protocol=http]' \
    --test --no-progress --output - \
    "https://www.youtube.com/watch?v=$scrt_video_id" >/dev/null || exit 1
done
```

Обидві команди мають завершитися успішно. **Sign in to confirm you're not a bot** означає, що цей IP теж заблокований: не підключай його як вирішення проблеми. Помилки Node/EJS або встановлення екстрактора спершу потребують виправлення залежностей. Успішний короткий тест підтверджує доступ до початку аудіо; повне прослуховування перевіряється через бота після налаштування проксі.

## 3. Безкоштовне ім'я сервера і HTTPS

Після успішної перевірки прив'яжи домен до IPv4 VM. Можна створити безкоштовний піддомен на [Duck DNS](https://www.duckdns.org/). Надалі `YOUR_NAME.duckdns.org` — приклад, який треба замінити на **свій** піддомен. Його A-запис має вказувати на VM; не додавай AAAA для непідготовленого IPv6.

У Security List або NSG дозволь inbound TCP **80** для перевірки та поновлення сертифіката і **8443** для проксі. Якщо маєш фіксований вихідний IP Railway, обмеж 8443 ним; інакше доступ захищають HTTPS і пароль. Збережи обмеження SSH своїм IP.

На свіжій VM встанови Squid з OpenSSL, Certbot і засоби керування паролем/правилами. Під час встановлення `iptables-persistent` можна зберегти наявні правила. Команди нижче додають правила, не очищаючи існуючий firewall:

```bash
sudo apt-get install -y squid-openssl apache2-utils certbot iptables-persistent
sudo systemctl stop squid
sudo iptables -I INPUT 1 -p tcp --dport 80 -m conntrack --ctstate NEW -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 8443 -m conntrack --ctstate NEW -j ACCEPT
sudo netfilter-persistent save
sudo certbot certonly --standalone --cert-name scrt-media-proxy -d YOUR_NAME.duckdns.org
```

Certbot запитає email та згоду з умовами. Якщо перевірка домену не проходить, перевір A-запис, Internet Gateway і TCP 80 у **мережевому та системному** firewall. [Документація Certbot](https://eff-certbot.readthedocs.io/en/stable/using.html).

## 4. Пароль і налаштування Squid

На цій новій VM створи користувача `scrt`. `htpasswd` запитає пароль без додавання його до історії команд. Використай окремий випадковий пароль довжиною 24–32 символи; він не має збігатися з токеном бота або `MEDIA_INTERNAL_SECRET`.

```bash
sudo htpasswd -cB /etc/squid/passwords scrt
sudo chown root:proxy /etc/squid/passwords
sudo chmod 640 /etc/squid/passwords
sudo install -d -o root -g proxy -m 750 /etc/squid/tls
sudo install -o root -g proxy -m 640 /etc/letsencrypt/live/scrt-media-proxy/fullchain.pem /etc/squid/tls/fullchain.pem
sudo install -o root -g proxy -m 640 /etc/letsencrypt/live/scrt-media-proxy/privkey.pem /etc/squid/tls/privkey.pem
sudo cp -a /etc/squid/squid.conf /etc/squid/squid.conf.before-scrt
sudo nano /etc/squid/squid.conf
```

Заміни вміст `squid.conf` цим конфігом для Squid 6 на Ubuntu 24.04. Проксі приймає тільки авторизований CONNECT на публічні адреси з портом 443; приватні адреси та адреса metadata-сервісу заборонені. Підтримується CONNECT до IP, який перевірив і закріпив бот.

```squidconf
visible_hostname scrt-youtube-proxy
https_port 0.0.0.0:8443 tls-cert=/etc/squid/tls/fullchain.pem tls-key=/etc/squid/tls/privkey.pem

auth_param basic program /usr/lib/squid/basic_ncsa_auth /etc/squid/passwords
auth_param basic children 5 startup=1 idle=1
auth_param basic realm SCRT YouTube proxy
auth_param basic credentialsttl 1 hour
acl authenticated proxy_auth REQUIRED
acl CONNECT method CONNECT
acl SSL_ports port 443
acl private_destinations dst 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12
acl private_destinations dst 192.0.0.0/24 192.0.2.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4
acl private_destinations dst ::/128 ::1/128 ::ffff:0:0/96 fc00::/7 fe80::/10 ff00::/8 2001:db8::/32

http_access deny !CONNECT
http_access deny !SSL_ports
http_access deny !authenticated
http_access deny private_destinations
http_access allow authenticated
http_access deny all

cache deny all
connect_timeout 8 seconds
read_timeout 5 minutes
shutdown_lifetime 3 seconds
```

Сертифікат захищає з'єднання Railway → проксі; TLS YouTube залишається всередині CONNECT і перевіряється ботом. Не додавай `ssl_bump`, `http_access allow all` або вимкнення перевірки сертифікатів. [HTTPS у Squid](https://www.squid-cache.org/Doc/config/https_port/), [авторизація Squid](https://www.squid-cache.org/Doc/config/auth_param/).

Перед запуском перевір конфіг. Якщо будь-яка команда неуспішна, не переходь до наступної:

```bash
sudo squid -k parse
sudo systemctl enable --now squid
sudo systemctl status squid --no-pager
```

## 5. Поновлення сертифіката

Створи deploy hook, який копіює поновлений сертифікат з належними правами та дає Squid команду перечитати конфігурацію:

```bash
sudo install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
sudo tee /etc/letsencrypt/renewal-hooks/deploy/scrt-squid >/dev/null <<'EOF'
#!/bin/sh
set -eu
[ "$RENEWED_LINEAGE" = /etc/letsencrypt/live/scrt-media-proxy ] || exit 0
install -o root -g proxy -m 640 "$RENEWED_LINEAGE/fullchain.pem" /etc/squid/tls/fullchain.pem
install -o root -g proxy -m 640 "$RENEWED_LINEAGE/privkey.pem" /etc/squid/tls/privkey.pem
/usr/sbin/squid -k parse
/usr/sbin/squid -k reconfigure
EOF
sudo chmod 750 /etc/letsencrypt/renewal-hooks/deploy/scrt-squid
sudo systemctl enable --now certbot.timer
sudo certbot renew --dry-run --run-deploy-hooks
```

TCP 80 має залишатися доступним для автоматичного поновлення. Hook використовує [reconfigure](https://wiki.squid-cache.org/SquidFaq/InstallingSquid), не зупиняючи службу. Після тестового поновлення перевір HTTPS-з'єднання ще раз; після першого налаштування також перевір поведінку під час активного треку. Бот збереже чергу при мережевій відмові.

## 6. Підключення Railway і перевірка

Спершу перевір із VM, що без пароля CONNECT відхиляється з **407**, а з паролем YouTube відкривається. Друга команда запитає пароль користувача `scrt`; не вказуй його прямо у командному рядку. Не використовуй `--insecure` або `--proxy-insecure`.

```bash
curl --proxy https://YOUR_NAME.duckdns.org:8443 --connect-timeout 8 --max-time 20 --head https://www.youtube.com/
curl --proxy https://YOUR_NAME.duckdns.org:8443 --proxy-user scrt --connect-timeout 8 --max-time 20 --head https://www.youtube.com/
curl --proxy https://YOUR_NAME.duckdns.org:8443 --proxy-user scrt --connect-timeout 8 --max-time 20 --head https://169.254.169.254/
```

Третя команда повинна отримати **403 від проксі**: metadata-адреса недоступна навіть з правильним паролем. Успішний запит до головної сторінки YouTube не замінює перевірку треків.

У **Railway → сервіс бота → Variables** додай:

```dotenv
MEDIA_YOUTUBE_PROXY_URL=https://scrt:PASSWORD@YOUR_NAME.duckdns.org:8443
```

Підстав свій пароль і піддомен; зарезервовані символи в паролі потрібно percent-encode. Зберігай значення лише у змінних бота. На Oracle не перенось ключі Discord/Firebase. Приватний SSH-ключ, пароль проксі та токен Duck DNS не надсилай у чат або Git.

Задеплой код підтримки проксі та перезапусти бот. `MEDIA_YOUTUBE_IP_FAMILY` у цьому режимі не визначає маршрут YouTube. У нових логах має бути `youtubeRoute: proxy`, а для екстрактора й HTTP — `route: proxy`.

Перевір обидві проблемні пісні через посилання у вебпошуку, пошук за назвою, повне прослуховування і природний перехід до наступного треку. Після штучного вимкнення проксі трек і черга мають зберегтися з повідомленням про мережеву помилку. SoundCloud і пряме аудіопосилання використовують попередній маршрут. Віднови проксі, натисни «Відновити» та перевір саме збережений трек.

`PROXY_AUTH_REQUIRED` означає відхилення пароля. `NETWORK_UNREACHABLE` потребує перевірки домену, firewall, сертифіката і стану Squid. `NETWORK_BLOCKED` означає відмову самого YouTube; налаштований проксі не гарантує прийняття його IP. Для діагностики на VM використовуй `sudo journalctl -u squid -n 50 --no-pager` і `sudo tail -n 50 /var/log/squid/cache.log`.

Для повернення до прямого маршруту прибери `MEDIA_YOUTUBE_PROXY_URL` і перезапусти бот; це не зніме попереднє блокування Railway. [Oracle може вилучати малозавантажені Always Free VM](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), тому цілодобова доступність безкоштовного сервера не гарантована.

## Що перевірено

Інструкцію звірено з поточними офіційними матеріалами Oracle, Ubuntu/Squid, Certbot і Duck DNS та з конфігурацією SCRT. Синтаксис усіх семи Bash-блоків перевірено через `bash -n`. Окремий локальний TCP-пробник підтвердив, що наявна збірка екстрактора починає TLS handshake до `https://` проксі; це не перевірка робочого сертифіката або Oracle. Команди Squid/Certbot на Oracle ще не виконані; Linux для перевірки конфігурації локально недоступний. Наявні перевірки коду проксі та їхні практичні межі описані в [Media operations](media.md#setup). Завершеною інтеграцію можна вважати після перевірки реальної VM і відтворення у Discord.
