const { $ } = require('@wdio/globals')
const Page = require('./page');

/**
 * sub page containing specific selectors and methods for a specific page
 */
class LoginPage extends Page {
    get inputEmail () {
        return $('input[type="email"]');
    }

    get inputPassword () {
        return $('input[type="password"]');
    }

    get btnSubmit () {
        return $("//button[normalize-space()='Login']");
    }

    get errorMessage () {
        return $('p.text-red-500');
    }

    async login (email, password) {
        await this.inputEmail.setValue(email);
        await this.inputPassword.setValue(password);
        await this.btnSubmit.click();
    }

    open () {
        return super.open('/login');
    }
}

module.exports = new LoginPage();
