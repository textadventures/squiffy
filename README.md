Squiffy
=======

Squiffy is a tool for creating multiple choice interactive fiction. Squiffy is written entirely in JavaScript - the compiler uses [Node.js](http://nodejs.org/) and the games it generates run in a web browser.

For installation and usage instructions, [see the documentation](http://docs.textadventures.co.uk/squiffy/).

The plans for forthcoming releases are on the [development roadmap](http://docs.textadventures.co.uk/squiffy/roadmap.html).

For discussion and help, see [the forums](http://forum.textadventures.co.uk/viewforum.php?f=24).

##Contributing
Contributions are welcome! Fork this repo, fix a bug or add a feature, and then create a pull request. See below for local development steps.


###Windows
Setting up your Windows environment for development and testing is breeze! 
1. Clone master of your fork to your local machine (ex, C:\projects\squiffy\). 
2. Install Nodejs if you haven't already
3. From your squiffy directory, run
        npm install
4. Next run 
        npm install squiffy -g
5. Delete the new 'squiffy' folder in your gloabl node_modules folder:    
        C:\Users\[yourUser]\AppData\Roaming\npm\node_modules\squiffy 
4. Open a new CMD as Admin.
5. Create a symlink between your npm and development squiffy folders by running 
        mklink /D C:\Users\[yourUser]\AppData\Roaming\npm\node_modules\squiffy C:\projects\squiffy

Now running 'squiffy helloworld.squiffy' will use the code from your project folder!