// Сервер бота для уведомлений сотрудников
const BOT_SERVER_URL = '/api/notify';
let selectedBranch = '';

const branchNameInput = document.getElementById('branchName');
const branchHiddenInput = document.getElementById('branch');

function updateSelectedBranch(branch, button) {
    selectedBranch = branch;
    branchNameInput.value = branch;
    branchHiddenInput.value = branch;

    document.querySelectorAll('.branch-card').forEach(card => {
        card.classList.toggle('selected', card.dataset.branch === branch);
    });
}

document.querySelectorAll('.btn-branch-select').forEach(button => {
    button.addEventListener('click', () => {
        updateSelectedBranch(button.dataset.branch, button);
    });
});

document.getElementById('registrationForm').addEventListener('submit', function(event) {
    event.preventDefault();

    // Сбор данных формы
    const fullName = document.getElementById('fullName').value.trim();
    const birthDate = document.getElementById('birthDate').value;
    const phone = document.getElementById('phone').value.trim();
    const email = document.getElementById('email').value.trim();
    const rehabTypeSelect = document.getElementById('rehabType');
    const rehabType = rehabTypeSelect.options[rehabTypeSelect.selectedIndex].text;
    const message = document.getElementById('message').value.trim();
    const photosInput = document.getElementById('photos');
    const branch = branchHiddenInput.value;

    // Валидация обязательных полей
    if (!fullName || !birthDate || !phone || !rehabType || !branch) {
        alert('Пожалуйста, заполните все обязательные поля и выберите филиал.');
        return;
    }

    // Проверка email если заполнен
    if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            alert('Пожалуйста, введите корректный email.');
            return;
        }
    }

    // Создание FormData для отправки файлов
    const formData = new FormData();
    formData.append('fullName', fullName);
    formData.append('branch', branch);
    formData.append('birthDate', birthDate);
    formData.append('phone', phone);
    formData.append('email', email);
    formData.append('rehabType', rehabType);
    formData.append('message', message);

    // Добавление фотографий
    for (let i = 0; i < photosInput.files.length; i++) {
        formData.append('photos', photosInput.files[i]);
    }

    // Отправка на сервер бота
    sendToBotServer(formData)
        .then(result => {
            if (result.ok) {
                if (result.queued) {
                    alert('Заявка принята и сохранена. Мы свяжемся с вами, как только сотрудник выйдет на смену.');
                } else {
                    alert('Регистрация успешно отправлена! Мы свяжемся с вами в ближайшее время.');
                }
                this.reset();
                selectedBranch = '';
                branchNameInput.value = '';
                branchHiddenInput.value = '';
                document.querySelectorAll('.branch-card').forEach(card => card.classList.remove('selected'));
            } else {
                alert('Заявка не отправлена. ' + (result.error || 'Проверьте, что сервер бота запущен.'));
            }
        });
});

function sendToBotServer(formData) {
    return fetch(BOT_SERVER_URL, {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(result => {
        return result;
    })
    .catch(error => {
        console.error('Ошибка подключения к серверу бота:', error);
        return { ok: false, error: error.message };
    });
}