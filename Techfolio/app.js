const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "./.env") });
const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mongoose = require("mongoose");
const session = require("express-session");
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose");
const findOrCreate = require("mongoose-findorcreate");
const methodOverride = require("method-override");
const marked = require("marked");
const createDomPurify = require("dompurify");
const { JSDOM } = require("jsdom");
const dompurify = createDomPurify(new JSDOM().window);

const app = express();

app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: false }))
app.use(express.static("public"));
app.use(methodOverride("_method"));

app.use(session({secret:process.env.SECRET,resave:false,saveUninitialized:false,}));
app.use(passport.initialize());
app.use(passport.session());

//---------DB connection---------
mongoose.connect(process.env.ATLAS_URI,{useNewUrlParser: true,useUnifiedTopology: true,});
mongoose.set("useCreateIndex", true);

const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", function () {
  console.log("connected");
});

//--------Post Schema--------
const postSchema = new mongoose.Schema({
  title: String,
  description: String, 
  blogText: String,
  account: String,
  email: String,
  authorId: String,
  timestamp: String,
  sanitizedHtml:{
    type: String,
    required: true
  }
});

postSchema.pre("validate", function(next){
  if(this.blogText){
    this.sanitizedHtml = dompurify.sanitize(marked(this.blogText))
  }
  next();
})
const Post = mongoose.model("Post", postSchema);

//--------User Schema--------
const userSchema = new mongoose.Schema({
  userHandle: String,
  email: String,
  password: String,
  googleId: String,
  posts: [postSchema],
  // likedPosts: [String],
});

userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findOrCreate);

const User = mongoose.model("students", userSchema);

passport.use(User.createStrategy());

passport.serializeUser(function (user, done) {
  done(null, user.id);
});

passport.deserializeUser(function (id, done) {
  User.findById(id, function (err, user) {
    done(err, user);
  });
});

//-----------Routes requests-----------
app.get("/", function (req, res) {
  res.render("login", { authenticated: req.isAuthenticated() });
});

//get Home
app.get("/home", (req, res) => {
  Post.find((err, posts) => {
    posts.sort((a, b) => {
      return new Date(b.timestamp) - new Date(a.timestamp);
    });

    if (req.isAuthenticated()) {
      User.findById(req.user.id, (err, foundUser) => {
        if (err) {
          console.log(err);
          res.send("There was an error. Please try again.");
        } else {
          res.render("home", {
            newPost: posts,
            authenticated: req.isAuthenticated(),
            userLikedPosts: foundUser.likedPosts,
          });
        }
      });
    } else {
      res.render("home", {
        newPost: posts,
        authenticated: req.isAuthenticated(),
        userLikedPosts: null,
      });
    }
  });
});

//Google Oauth
app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get(
  "/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/signin",
    successRedirect: "/",
  })
);



//get SignIn
app.get("/login", function (req, res) {
  res.render("login", { authenticated: req.isAuthenticated() });
});

app.get("/signup1", function (req, res) {
  res.render("signup1");
});

//post SignUp
app.post("/signup", (req, res) => {
  User.register(
    { username: req.body.username, userHandle: req.body.userhandle },
    req.body.password,
    (err, user) => {
      if (err) {
        console.log(err);
        res.redirect("/signup");
      } else {
        passport.authenticate("local")(req, res, () => {
          res.redirect("/");
        });
      }
    }
  );
});

//post SignIn
app.post("/signin", (req, res) => {
  const user = new User({
    username: req.body.username,
    password: req.body.password,
  });

  req.login(user, (err) => {
    if (err) {
      console.log(err);
      res.send("Incorrect email or password");
    } else {
      passport.authenticate("local")(req, res, () => {
        res.redirect("/home");
      });
    }
  });
});

//get LogOut
app.get("/logout", (req, res) => {
  req.logout();
  res.redirect("/");
});

//get Compose
app.get("/compose", (req, res) => {
  if (req.isAuthenticated()) {
    res.render("compose", { authenticated: req.isAuthenticated() });
  } else {
    res.send("Please login to write a post.");
  }
});

//post Compose
app.post("/compose", (req, res) => {
  User.findById(req.user.id, (err, foundUser) => {
    if (err) {
      console.log(err);
      res.send("Please log in to post.");
    } else {
      const today = new Date();
      const dateTime =
        today.getFullYear() +
        "-" +
        (today.getMonth() + 1) +
        "-" +
        today.getDate() +
        " " +
        today.getHours() +
        ":" +
        today.getMinutes() +
        ":" +
        today.getSeconds();

      const post = new Post({
        title: req.body.postTitle,
        description: req.body.postBody,
        blogText: req.body.postMarkdown,
        account: foundUser.userHandle,
        email: foundUser.username,
        authorId: req.user.id,
        timestamp: dateTime,
        likes: 0,
      });

      post.save();
      foundUser.posts.push(post);
      foundUser.save(() => {
        res.redirect("/home");
      });
    }
  });
});

//get Profile of own
app.get("/profile", (req, res) => {
  if (req.isAuthenticated()) {
    User.findById(req.user.id, (err, foundUser) => {
      if (err) {
        console.log(err);
        res.send("Please log in to see your profile.");
      } else {
        if (foundUser) {
          profile_name = foundUser.userHandle;
          profile_name.replace(/\s+/g, "");
          res.render("profile", {
            newPost: foundUser.posts,
            userName: profile_name,
            authenticated: req.isAuthenticated(),
            visitor: false,
          });
        } else {
          res.send("Please log in to see your profile.");
        }
      }
    });
  } else {
    res.send("Please log in to see your profile.");
  }
});


//get Particular Post
app.get("/posts/:postId", (req, res) => {
  const requestedPostId = req.params.postId;
  Post.findById(requestedPostId, (err, foundPost) => {
    if (err) {
      console.log(err);
      res.send("There was an error retrieving the post.");
    } else {
      if (foundPost) {
        if (req.isAuthenticated()) {
          User.findById(req.user.id, (err, foundMyself) => {
            if (err) {
              console.log(err);
              res.send("Please login to see this post");
            } else {
              if (foundMyself) {
                if (
                  JSON.stringify(foundMyself._id) ===
                  JSON.stringify(foundPost.authorId)
                ) {
                  res.render("post", {
                    id: foundPost._id,
                    authorId: foundPost.authorId,
                    title: foundPost.title,
                    author: foundPost.account,
                    description: foundPost.description,
                    blogText: foundPost.sanitizedHtml,
                    visitor: false,
                    authenticated: req.isAuthenticated(),
                  });
                } else {
                  res.render("post", {
                    id: foundPost._id,
                    authorId: foundPost.authorId,
                    title: foundPost.title,
                    author: foundPost.account,
                    description: foundPost.description,
                    blogText: foundPost.sanitizedHtml,
                    visitor: true,
                    authenticated: req.isAuthenticated(),
                  });
                }
              } else {
                res.send("Please login to see this post");
              }
            }
          });
        } else {
          res.render("post", {
            id: foundPost._id,
            authorId: foundPost.authorId,
            title: foundPost.title,
            author: foundPost.account,
            description: foundPost.description,
            blogText : foundPost.sanitizedHtml,
            visitor: true,
            authenticated: req.isAuthenticated(),
          });
        }
      }
    }
  });
});


//delete post
app.post("/delete", (req, res) => {
  const postId = req.body.postId;

  Post.findById(postId, (err, foundPost) => {
    if (err) {
      console.log(err);
      res.send("Post not found.");
    } else {
      if (foundPost) {
        const userId = foundPost.authorId;

        User.findById(userId, (err, foundUser) => {
          if (err) {
            console.log(err);
            res.send("There was an error. Please try again.");
          } else {
            if (foundUser) {
              for (let i = 0; i < foundUser.posts.length; i++) {
                if (
                  JSON.stringify(foundUser.posts[i]["_id"]) ===
                  JSON.stringify(postId)
                ) {
                  foundUser.posts.splice(i, 1);
                  foundUser.save();
                  break;
                }
              }
            } else {
              res.send("User not found");
            }
          }
        });

        Post.findByIdAndDelete(postId, (err, deletedPost) => {
          if (err) {
            console.log(err);
            res.send("There was an error. Please try again.");
          } else {
            if (deletedPost) {
              console.log(deletedPost);
              res.redirect("/profile");
            }
          }
        });
      } else {
        res.send("Post not found");
      }
    }
  });
});

app.get("/about", (req, res) => {
  res.render("about", { authenticated: req.isAuthenticated() });
});

let port = process.env.PORT;
if (port == null || port == "") {
  port = 3000;
}

app.listen(port, function () {
  console.log("Server has started successfully");
});


