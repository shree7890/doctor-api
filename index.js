require("dotenv").config();
const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const app = express();
const port = process.env.PORT || 7000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* 
doctorsApplication
I84GuLxYJFfZ1vXq
*/
// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.tsora.mongodb.net/?retryWrites=true&w=majority`;
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.zej791e.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

const verifyJwt = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "UnAuthorized access" });
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET_KEY, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
};

async function run() {
  try {
    await client.connect();
    // console.log(client.connect());
    const appointmentCollection = client
      .db("doctorCollect")
      .collection("appointments");
    const bookingCollection = client.db("doctorCollect").collection("bookings");
    const userCollection = client.db("doctorCollect").collection("users");
    const doctorCollection = client.db("doctorCollect").collection("doctors");
    const paymentCollection = client.db("doctorCollect").collection("payments");

    // verify admin
    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requestUser = await userCollection.findOne({ email: requester });
      if (requestUser.role === "admin") {
        next();
      } else {
        res.status(403).json({ message: "Forbidden access" });
      }
    };

    // root route
    app.get("/success", (req, res) => {
      res.json({
        message: "successfully",
      });
    });
    // get services
    app.get("/services", async (req, res) => {
      const data = await appointmentCollection
        .find({})
        .project({ name: 1 })
        .toArray();
      res.send(data);
    });

    //availabel book slot service
    app.get("/available", async (req, res) => {
      const date = req.query.date;

      // step 1:  get all services
      const services = await appointmentCollection.find().toArray();

      // step 2: get the booking of that day. output: [{}, {}, {}, {}, {}, {}]
      const query = { appointmentDate: date };
      const bookings = await bookingCollection.find(query).toArray();

      // step 3: for each service
      services.forEach((service) => {
        // step 4: find bookings for that service. output: [{}, {}, {}, {}]
        const serviceBookings = bookings.filter(
          (book) => book.appointName === service.name
        );
        // step 5: select slots for the service Bookings: ['', '', '', '']
        const bookedSlots = serviceBookings.map((book) => book.slot);
        // step 6: select those slots that are not in bookedSlots
        const available = service.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        //step 7: set available to slots to make it easier
        service.slots = available;
      });

      res.send(services);
    });

    // bookings post method

    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        appointName: booking.appointName,
        appointmentDate: booking.appointmentDate,
        patientName: booking.patientName,
      };
      const exists = await bookingCollection.findOne(query);
      if (exists) {
        return res.send({ success: false, booking: exists });
      }
      const result = await bookingCollection.insertOne(booking);
      return res.send({ success: true, result });
    });

    // get user booking appointment

    app.get("/booking", verifyJwt, async (req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;
      if (patient === decodedEmail) {
        const query = { patientIdentify: patient };
        const bookings = await bookingCollection.find(query).toArray();
        return res.status(200).send(bookings);
      } else {
        return res.status(403).send({ message: "forbidden access" });
      }
    });

    // booking by id payment
    app.get("/booking/:id", verifyJwt, async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const book = await bookingCollection.findOne(query);
      res.status(200).json(book);
    });

    // user update

    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };

      const result = await userCollection.updateOne(filter, updateDoc, options);
      const token = jwt.sign(
        {
          email: email,
        },
        process.env.JWT_SECRET_KEY,
        { expiresIn: "1h" }
      );
      res.status(200).json({ result, token });
    });

    app.put("/user/admin/:email", verifyJwt, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };

      const result = await userCollection.updateOne(filter, updateDoc);
      res.status(200).json(result);
    });

    //get all users

    app.get("/users", verifyJwt, async (_req, res) => {
      const dashUser = await userCollection.find({}).toArray();
      res.status(200).json(dashUser);
    });

    // delete user
    app.delete("/user/:email", verifyJwt, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await userCollection.deleteOne(query);
      res.status(200).json(user);
    });
    // admin user get from usercollection

    app.get("/user/admin/:email", verifyJwt, async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user.role === "admin";
      res.status(200).json({ admin: isAdmin });
    });

    // doctor add can be admin
    app.post("/doctor", verifyJwt, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorCollection.insertOne(doctor);
      res.status(201).json(result);
    });

    // doctor get
    app.get("/doctor", async (req, res) => {
      const doctors = await doctorCollection.find().toArray();
      res.status(200).json(doctors);
    });
    // doctor delete
    app.delete("/doctor/:email", verifyJwt, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const result = await doctorCollection.deleteOne(filter);
      res.status(200).json(result);
    });

    //payment submit
    app.post("/create-payment-intent", verifyJwt, async (req, res) => {
      const pay = req.body;
      const totalAmount = pay.price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: totalAmount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.status(200).json({
        clientSecret: paymentIntent.client_secret,
      });
    });

    //payment store database
    app.patch("/booking/:id", verifyJwt, async (req, res) => {
      const id = req.params.id;
      const payment = req.body;
      const filter = { _id: ObjectId(id) };
      const updatedDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId,
        },
      };

      const result = await paymentCollection.insertOne(payment);
      const updatedBooking = await bookingCollection.updateOne(
        filter,
        updatedDoc
      );
      res.status(200).json(updatedBooking);
    });
  } finally {
    // await client.close()
  }
}
run().catch(console.dir);
// client.connect((err) => {
//   const collection = client.db("test").collection("devices");
//   // perform actions on the collection object
//   client.close();
// });
app.get("/", (req, res) => {
  res.json({ message: "successfully deploy" });
});
app.listen(port, () => {
  console.log("server listen successfully ", port);
});
