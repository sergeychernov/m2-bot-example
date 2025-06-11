# m2-bot-example

Телеграм-бот с интеграцией YandexGPT, развернутый в Yandex Cloud Functions.

## Настройка Yandex Cloud

### 1. Создание каталога

1. Войдите в [консоль Yandex Cloud](https://console.cloud.yandex.ru/)
2. Выберите облако или создайте новое
3. Создайте новый каталог или используйте существующий
4. Скопируйте ID каталога (понадобится для `YC_FOLDER_ID`)

### 2. Создание сервисного аккаунта

1. Перейдите в раздел "Сервисные аккаунты"
2. Нажмите "Создать сервисный аккаунт"
3. Укажите имя (например, `telegram-bot-sa`)
4. Назначьте роли:
   - `ai.languageModels.user` - для работы с YandexGPT
   - `serverless.functions.invoker` - для выполнения функций
5. Скопируйте ID сервисного аккаунта (понадобится для `YC_SERVICE_ACCOUNT`)

### 3. Создание Cloud Function

1. Перейдите в раздел "Cloud Functions"
2. Нажмите "Создать функцию"
3. Укажите имя функции (например, `telegram-bot`)
4. Выберите среду выполнения: `nodejs18`
5. Установите:
   - Точка входа: `index.handler`
   - Таймаут: `30s`
   - Память: `128 МБ`
6. В разделе "Сервисный аккаунт" выберите созданный ранее аккаунт
7. Скопируйте имя функции (понадобится для `YC_FUNCTION_NAME`)

### 4. Получение токена бота

1. Найдите [@BotFather](https://t.me/BotFather) в Telegram
2. Отправьте команду `/newbot`
3. Следуйте инструкциям для создания бота
4. Скопируйте токен бота (понадобится для `BOT_TOKEN`)

## Настройка файла .env

Создайте файл `.env` в корне проекта и заполните следующие переменные:

```env
# Токен Telegram бота (получен от @BotFather)
BOT_TOKEN=your_bot_token_here

# ID каталога Yandex Cloud
YC_FOLDER_ID=your_folder_id_here

# Настройки Cloud Function
YC_FUNCTION_NAME=telegram-bot
YC_RUNTIME=nodejs18
YC_ENTRYPOINT=index.handler
YC_MEMORY=128m
YC_EXECUTION_TIMEOUT=30s

# ID облака Yandex Cloud
YC_CLOUD_ID=your_cloud_id_here

# ID сервисного аккаунта
YC_SERVICE_ACCOUNT=your_service_account_id_here
```

### Как получить значения:
- BOT_TOKEN : Получите от @BotFather после создания бота.
- YC_FOLDER_ID : ID вашего каталога в Yandex Cloud. Найти можно в консоли Yandex Cloud, выбрав нужный каталог (ID будет в URL или на странице каталога).
- YC_CLOUD_ID : ID вашего облака в Yandex Cloud. Найти можно в консоли Yandex Cloud, обычно отображается в верхней части страницы или в настройках облака.
- YC_SERVICE_ACCOUNT : ID сервисного аккаунта, созданного на предыдущем шаге.
- YC_FUNCTION_NAME : Имя вашей Cloud Function, указанное при создании.
- Остальные параметры ( YC_RUNTIME , YC_ENTRYPOINT , YC_MEMORY , YC_EXECUTION_TIMEOUT ) обычно можно оставить по умолчанию, если вы следовали инструкции.
## Установка и развертывание
### Предварительные требования
1. Установите Yandex Cloud CLI :
   Если у вас еще не установлен Yandex Cloud CLI, следуйте официальной инструкции .
   
   ```
   # Пример для Linux и macOS
   curl -sSL https://storage.
   yandexcloud.net/yandexcloud-yc/
   install.sh | bash
   ```
   После установки перезапустите терминал или выполните команду, предложенную установщиком (например, source ~/.bashrc или source ~/.zshrc ).
2. Инициализируйте Yandex Cloud CLI :
   
   ```
   yc init
   ```
   Следуйте инструкциям для авторизации (обычно через браузер) и выбора профиля по умолчанию (облако, каталог).
3. Установите Node.js и npm :
   Убедитесь, что у вас установлена Node.js (версия 18 или выше, соответствующая YC_RUNTIME ) и npm.
   
   ```
   node --version
   npm --version
   ```
### Пошаговое развертывание 1. Клонирование репозитория (если еще не сделали)
```
# git clone <your-repo-url>
# cd m2-bot-example
``` 2. Установка зависимостей проекта
В корневой директории проекта выполните:

```
npm install
``` 3. Настройка окружения
Убедитесь, что файл .env создан и корректно заполнен (см. Настройка файла .env ).
 4. Настройка профиля Yandex Cloud CLI (опционально, если yc init уже настроил нужный каталог)
Скрипт npm run setup может помочь настроить CLI на использование переменных из .env :

```
npm run setup
```
Эта команда выполнит:

```
dotenv -e .env -- bash -c 'yc 
config set cloud-id 
$YC_CLOUD_ID && yc config set 
folder-id $YC_FOLDER_ID'
```
Проверьте текущую конфигурацию:

```
yc config list
``` 5. Сборка проекта (компиляция TypeScript)
```
npm run build
```
Эта команда компилирует TypeScript файлы (например, index.ts ) в JavaScript ( index.js ) в соответствии с tsconfig.json .
 6. Создание архива для развертывания
```
npm run zip
```
Эта команда обычно выполняет npm run build и затем упаковывает необходимые файлы ( index.js , package.json , node_modules или yarn.lock , clients.json и т.д.) в function.zip .
 7. Развертывание функции в Yandex Cloud
```
npm run deploy
```
Эта команда использует значения из .env для выполнения команды yc serverless function version create ... . Она загружает function.zip и создает новую версию функции со всеми указанными параметрами и переменными окружения.

Пример команды, которая выполняется внутри npm run deploy (значения подставляются из .env ):

```
yc serverless function version 
create \
  --function-name=$YC_FUNCTION_NAME
   \
  --runtime=$YC_RUNTIME \
  --entrypoint=$YC_ENTRYPOINT \
  --memory=$YC_MEMORY \
  --execution-timeout=$YC_EXECUTION
  _TIMEOUT \
  --source-path=function.zip \
  --cloud-id=$YC_CLOUD_ID \
  --folder-id=$YC_FOLDER_ID \
  --service-account-id=$YC_SERVICE_
  ACCOUNT \
  --environment 
  BOT_TOKEN=$BOT_TOKEN,
  YC_FOLDER_ID=$YC_FOLDER_ID
```
### Альтернативные способы развертывания Развертывание через консоль Yandex Cloud
1. Выполните сборку и создание архива локально:
   ```
   npm run zip
   ```
2. Откройте консоль Yandex Cloud .
3. Перейдите в Cloud Functions → ваша функция.
4. Нажмите "Создать версию" (или "Редактировать" для существующей версии).
5. Способ загрузки : ZIP-архив.
6. Файл : Загрузите созданный function.zip .
7. Установите параметры:
   - Среда выполнения: nodejs18 (или указанная в YC_RUNTIME ).
   - Точка входа: index.handler .
   - Таймаут: 30 секунд (или указанный в YC_EXECUTION_TIMEOUT ).
   - Память: 128 МБ (или указанная в YC_MEMORY ).
   - Сервисный аккаунт: выберите ваш telegram-bot-sa .
8. Переменные окружения : Добавьте необходимые переменные:
   - BOT_TOKEN : ваш токен бота.
   - YC_FOLDER_ID : ID вашего каталога.
9. Нажмите "Создать версию".
### Получение URL функции
После успешного развертывания функции ей будет присвоен URL для вызова.

1. Через консоль Yandex Cloud :
   
   - Перейдите в Cloud Functions → ваша функция.
   - На вкладке "Обзор" найдите поле "Ссылка для вызова".
2. Через Yandex Cloud CLI :
   
   ```
   # Получить информацию о 
   функции, включая URL
   yc serverless function get 
   $YC_FUNCTION_NAME --format json
   ```
   Ищите ключ http_invoke_url в выводе JSON.
   Или более короткая команда:
   
   ```
   yc serverless function get 
   $YC_FUNCTION_NAME --format 
   json | jq -r '.http_invoke_url'
   ```
   (Требуется установленный jq )
### Настройка webhook
Telegram бот должен знать, куда отправлять обновления (сообщения от пользователей). Для этого используется webhook.

1. Скопируйте URL вашей функции, полученный на предыдущем шаге.
2. Замените <BOT_TOKEN> на ваш токен бота и <FUNCTION_URL> на URL вашей функции в команде ниже:
   ```
   curl -X POST "https://api.
   telegram.org/bot<BOT_TOKEN>/
   setWebhook" \
        -H "Content-Type: 
        application/json" \
        -d '{"url": 
        "<FUNCTION_URL>"}'
   ``` Пример:
   ```
   curl -X POST "https://api.
   telegram.org/
   bot123456789:ABCDEFGHIKLMNOPQRST
   UVXYZ/setWebhook" \
        -H "Content-Type: 
        application/json" \
        -d '{"url": "https://
        functions.yandexcloud.net/
        d4e1j2g3h4i5k6l7m8"}'
   ```
3. Выполните эту команду в терминале. Успешный ответ от Telegram API будет выглядеть так:
   ```
   {"ok":true,"result":true,
   "description":"Webhook was set"}
   ```
### Проверка развертывания
1. Проверьте статус функции в консоли Yandex Cloud или через CLI:
   
   ```
   yc serverless function list
   yc serverless function version 
   list 
   --function-name=$YC_FUNCTION_NAM
   E
   ```
   Убедитесь, что последняя версия активна.
2. Проверьте логи функции :
   Отправьте сообщение вашему боту в Telegram. Затем проверьте логи функции на наличие ошибок или информации об обработке запроса.
   
   - В консоли Yandex Cloud : Cloud Functions → ваша функция → вкладка "Логи".
   - Через CLI (замените $YC_FUNCTION_NAME или получите ID группы логов из информации о функции):
     ```
     yc logging read 
     --function-name=$YC_FUNCTION_
     NAME --since=5m
     ```
3. Протестируйте бота : Отправьте несколько различных команд/сообщений боту и убедитесь, что он отвечает корректно.
## Команды npm
- npm run build : Компиляция TypeScript в JavaScript.
- npm run zip : Создание архива function.zip для развертывания (включает build ).
- npm run setup : Настройка Yandex Cloud CLI с параметрами из .env (устанавливает облако и каталог по умолчанию).
- npm run deploy : Полное развертывание новой версии функции в Yandex Cloud (включает zip ).
- npm test : (Если настроены тесты) Запуск тестов.
## Обновление функции
Для обновления уже развернутой функции:

1. Внесите необходимые изменения в код (например, в index.ts ).
2. Пересоберите и разверните функцию:
   ```
   npm run deploy
   ``` Эта команда создаст новую версию функции с вашими изменениями. Старые версии сохраняются, но активной становится новая.
## Отладка
Для просмотра логов функции:

1. Перейдите в консоль Yandex Cloud.
2. Откройте Cloud Functions → ваша функция.
3. Перейдите на вкладку "Логи". Выберите нужный период времени.
Или используйте Yandex Cloud CLI:

```
# Получить ID группы логов для 
вашей функции
LOG_GROUP_ID=$(yc serverless 
function get $YC_FUNCTION_NAME 
--format json | jq -r '.
log_group_id')

# Читать логи (например, за 
последний час)
yc logging read 
--group-id=$LOG_GROUP_ID --since=1h

# Следить за логами в реальном 
времени (если поддерживается 
клиентом или через сторонние 
утилиты)
# yc logging read 
--group-id=$LOG_GROUP_ID --follow 
(проверьте актуальность команды)
```
### Отладка развертывания
- Проверьте переменные окружения : Убедитесь, что все переменные в .env корректны и соответствуют вашим ресурсам в Yandex Cloud.
- Проверьте конфигурацию Yandex Cloud CLI : yc config list .
- Проверьте права доступа : Убедитесь, что сервисный аккаунт имеет необходимые роли ( ai.languageModels.user , serverless.functions.invoker , editor на каталог).
  ```
  yc iam service-account 
  list-access-bindings --id 
  $YC_SERVICE_ACCOUNT
  yc resource-manager folder 
  list-access-bindings --id 
  $YC_FOLDER_ID
  ```
## Структура проекта
```
├── .env             # Переменные 
окружения (локально, не в git!)
├── .gitignore       # Файлы, 
игнорируемые git
├── index.ts         # Основной 
код бота (TypeScript)
├── package.json     # Зависимости 
проекта и npm-скрипты
├── package-lock.json # Фиксация 
версий зависимостей
├── tsconfig.json    # 
Конфигурация TypeScript компилятора
├── clients.json     # Пример 
файла с данными клиентов (если 
используется)
└── README.md        # Эта 
документация
```
## Безопасность
- Никогда не коммитьте файл .env или другие файлы с секретами (токены, ключи) в систему контроля версий (git). Добавьте .env в ваш .gitignore файл.
- Используйте сильные и уникальные токены для бота и сервисных аккаунтов.
- Регулярно проверяйте и ограничивайте права сервисного аккаунта только необходимыми ролями.
- Рассмотрите возможность использования Yandex Lockbox для хранения секретов, если требуется повышенная безопасность.
## Устранение неполадок
### Ошибка 401 (Unauthorized) при запросе к YandexGPT
- Проверьте, что IAM-токен получается и передается корректно в заголовке Authorization .
- Убедитесь, что сервисный аккаунт, от имени которого выполняется функция, имеет роль ai.languageModels.user .
- Проверьте, что YC_FOLDER_ID в переменных окружения функции указан правильно (тот, где разрешено использование YandexGPT).
### Ошибка 403 (Forbidden) при запросе к YandexGPT
- Аналогично ошибке 401, проверьте права сервисного аккаунта и YC_FOLDER_ID .
- Убедитесь, что для вашего облака/каталога не исчерпаны квоты на использование YandexGPT.
### Функция не отвечает или возвращает ошибку после развертывания
- Проверьте логи функции в Yandex Cloud. Это первое место, где стоит искать причину проблемы.
- Убедитесь, что webhook для Telegram настроен правильно и указывает на актуальный URL функции.
- Проверьте таймауты функции. Если обработка запроса занимает больше времени, увеличьте таймаут.
- Убедитесь, что все необходимые зависимости установлены и включены в архив function.zip (обычно npm install перед npm run zip решает это).
### Ошибка "Function not found" при вызове yc serverless function ...
- Проверьте правильность написания имени функции ( $YC_FUNCTION_NAME ).
- Убедитесь, что вы работаете в правильном каталоге ( yc config list ).
### Ошибка "Access denied" при развертывании
- Проверьте, что ваш пользователь или сервисный аккаунт, используемый Yandex Cloud CLI, имеет права на создание версий функций в указанном каталоге (например, роль editor или admin на каталог).