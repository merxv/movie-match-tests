const { $, browser } = require('@wdio/globals')
const Page = require('./page')

class GenresPage extends Page {
    get heading () {
        return $('h1=Browse by Genre')
    }

    genreCard(genre) {
        return $(`//a[@href='/genres/${genre}' and .//*[contains(normalize-space(), '${genre}')]]`)
    }

    async waitForLoaded () {
        await this.heading.waitForDisplayed({ timeout: 10000 })
    }

    async selectGenre(genre) {
        const card = await this.genreCard(genre)
        await card.waitForClickable({ timeout: 10000 })
        await card.click()
    }
}

module.exports = new GenresPage()
